-- KG-0 observer. Configure this filter at pre-ast so native identifiers and
-- citation keys are observed before Quarto transforms them. The document is
-- returned unchanged; final HTML destinations are verified by the post-render
-- coordinator, rather than being assumed from these observations.
--
-- Supported APIs: https://quarto.org/docs/extensions/lua-api.html
-- Phase ordering: https://quarto.org/docs/advanced/quarto-ast.html

local function fail(message)
  -- Quarto's emulated filter environment exposes a logging error(), so use
  -- the Lua assertion primitive to stop reliably rather than continuing.
  assert(false, "knowledge-graph-extraction: " .. message)
end

local function io_path(path)
  -- Lua's Windows C file APIs otherwise reject long observation filenames,
  -- even when Pandoc/Deno have successfully created their directory.
  if pandoc.system.os ~= "mingw32" or not pandoc.path.is_absolute(path) then
    return path
  end
  local normalized = path:gsub("/", "\\")
  if normalized:sub(1, 4) == "\\\\?\\" then return normalized end
  if normalized:sub(1, 2) == "\\\\" then
    return "\\\\?\\UNC\\" .. normalized:sub(3)
  end
  return "\\\\?\\" .. normalized
end

local function relative_path(value, field)
  if type(value) ~= "string" or value == "" then
    fail(field .. " must be a non-empty project-relative path")
  end
  local normalized = value:gsub("\\", "/")
  -- Reject traversal, absolute/drive paths and empty components. This is a
  -- lexical boundary; source/dependency real-path checks belong to prepare.
  if normalized:sub(1, 1) == "/" or normalized:find(":", 1, true)
      or normalized:find("//", 1, true)
      or normalized:find("[%z\1-\31]")
      or normalized:sub(-1) == "/" then
    fail(field .. " must stay within the declared project")
  end
  for component in normalized:gmatch("[^/]+") do
    if component == "." or component == ".." then
      fail(field .. " must not contain dot or traversal components")
    end
  end
  return normalized
end

local function read_run(project_directory, optional)
  local manifest_path = pandoc.path.join({
    project_directory, ".quarto", "knowledge-graph", "run.json"
  })
  local handle = io.open(io_path(manifest_path), "rb")
  if not handle then
    if optional then return nil end
    fail("no prepared run manifest; run the configured project pre-render " ..
      "script before HTML extraction")
  end
  local bytes = handle:read("*a")
  handle:close()
  local ok, run = pcall(quarto.json.decode, bytes)
  if not ok or type(run) ~= "table" then
    fail("the prepared run manifest is not a valid JSON object")
  end
  if type(run.runId) ~= "string" or #run.runId > 100
      or not run.runId:match("^[A-Za-z0-9_-]+$") then
    fail("the prepared runId must contain only letters, digits, '_' and '-'")
  end
  run.stateDir = relative_path(run.stateDir, "stateDir")
  if type(run.sources) ~= "table" then
    fail("the prepared run must declare its source inventory")
  end
  return run
end

local function declared_source(run, input_file, project_directory)
  local source = relative_path(
    pandoc.path.make_relative(input_file, project_directory), "input source"
  )
  for _, entry in ipairs(run.sources) do
    if type(entry) == "table"
        and relative_path(entry.path, "declared source") == source then
      return source
    end
  end
  -- An ordinary or deliberately unselected page needs no graph declaration.
  return nil
end

local function sorted_keys(set)
  local values = {}
  for value in pairs(set) do
    values[#values + 1] = value
  end
  table.sort(values)
  return values
end

-- RFC 3986 unreserved bytes survive; all other UTF-8 bytes use uppercase %HH.
-- Coordinator equivalent: encodeURIComponent(source), then escape [!'()*].
local function observation_filename(source)
  return (source:gsub("[^A-Za-z0-9._~-]", function(byte)
    return string.format("%%%02X", string.byte(byte))
  end)) .. ".json"
end

local function write_observation(project_directory, run, observation)
  local directory = pandoc.path.join({
    project_directory, run.stateDir, "runs", run.runId, "observations"
  })
  pandoc.system.make_directory(directory, true)
  local filename = observation_filename(observation.source)
  if observation.status ~= "observed" then
    filename = filename .. ".skip-" .. FORMAT:gsub("[^A-Za-z0-9_-]", "_") .. ".json"
  end
  local destination = pandoc.path.join({ directory, filename })
  local existing = io.open(io_path(destination), "rb")
  if existing then
    existing:close()
    fail("this source already has an observation in the current run; " ..
      "prepare a new run instead of overwriting it")
  end

  local temporary = destination .. ".pending"
  local handle, open_error = io.open(io_path(temporary), "wb")
  if not handle then
    fail("cannot create local observation; check private state directory permissions and available space, then prepare a new run")
  end
  local written, write_error = handle:write(quarto.json.encode(observation), "\n")
  local closed, close_error = handle:close()
  if not written or not closed then
    fail("cannot finish local observation; check private state storage, then prepare a new run")
  end
  local renamed, rename_error = os.rename(io_path(temporary), io_path(destination))
  if not renamed then
    fail("cannot commit local observation; check private state directory permissions, then prepare a new run")
  end
end

-- These are private suggestions only. No replacement AST, automatic term
-- links, inferred identities or publication declarations are produced here.
local function authoring_observation(blocks, metadata)
  local result = { version = 0, complete = true,
    annotations = {}, terms = {}, diagnostics = {} }
  local count, diagnostic_count = 0, 0
  local function diagnostic(code)
    if diagnostic_count < 500 then
      result.diagnostics[#result.diagnostics + 1] = { code = code }
      diagnostic_count = diagnostic_count + 1
    else result.complete = false end
  end
  local function bounded(value, maximum)
    return type(value) == "string" and value:match("%S") ~= nil
      and #value <= maximum and not value:find("[%z\1-\31]")
  end
  local function add(collection, item)
    if count >= 500 then result.complete = false; diagnostic("candidate-limit"); return end
    collection[#collection + 1] = item
    count = count + 1
  end
  local function has_class(element, name)
    for _, class in ipairs(element.classes or {}) do
      if class == name then return true end
    end
    return false
  end
  local function definition(element)
    return element.identifier:match("^def%-%S+") ~= nil or has_class(element, "definition")
  end
  local function annotation(element)
    local attributes = element.attributes or {}
    local id = attributes["data-kg-id"]
    if id == nil then return end
    if not bounded(element.identifier, 512) then diagnostic("annotation-needs-native-anchor"); return end
    if not bounded(id, 2048) then diagnostic("invalid-annotation-id"); return end
    local item = { anchor = element.identifier, id = id }
    for _, pair in ipairs({ {"type", 80}, {"scope", 256}, {"lang", 80}, {"label", 256} }) do
      local value = attributes["data-kg-" .. pair[1]]
      if value ~= nil then
        if not bounded(value, pair[2]) then diagnostic("invalid-annotation-field"); return end
        item[pair[1] == "lang" and "language" or pair[1]] = value
      end
    end
    add(result.annotations, item)
  end
  local language = metadata.lang and pandoc.utils.stringify(metadata.lang) or "en"
  if not bounded(language, 80) then language = "en" end
  local function italic_terms(element)
    if not definition(element) then return end
    if not bounded(element.identifier, 512) then diagnostic("definition-needs-native-anchor"); return end
    local attributes = element.attributes or {}
    local term_language = attributes["data-kg-lang"] or language
    local scope = attributes["data-kg-scope"]
    if not bounded(term_language, 80) or (scope ~= nil and not bounded(scope, 256)) then
      diagnostic("invalid-definition-context"); return
    end
    element.content:walk({
      traverse = "topdown",
      Div = function(child)
        local id = child.identifier or ""
        if definition(child) or id:match("^thm%-") or id:match("^lem%-")
            or id:match("^prp%-") or id:match("^cor%-") or id:match("^proof%-")
            or has_class(child, "proof") or has_class(child, "theorem") then
          return child, false
        end
      end,
      -- Formatting in a nested heading is a title, not a definition term.
      Header = function(child) return child, false end,
      Emph = function(emphasis)
        local pieces = {}
        for _, inline in ipairs(emphasis.content) do
          if inline.t == "Str" then pieces[#pieces + 1] = inline.text
          elseif inline.t == "Space" or inline.t == "SoftBreak" or inline.t == "LineBreak" then
            pieces[#pieces + 1] = " "
          else diagnostic("complex-italic-term-skipped"); return emphasis, false end
        end
        local label = table.concat(pieces):gsub("%s+", " "):match("^%s*(.-)%s*$")
        if not bounded(label, 256) then diagnostic("invalid-italic-term"); return emphasis, false end
        local item = { anchor = element.identifier, label = label, language = term_language }
        if scope ~= nil then item.scope = scope end
        add(result.terms, item)
        return emphasis, false
      end
    })
  end
  blocks:walk({
    Div = function(element) annotation(element); italic_terms(element) end,
    Header = annotation,
    Span = annotation
  })
  return result
end

local function observe(doc)
  local settings = doc.meta["knowledge-graph"]
  local disabled = type(settings) == "table" and settings.enabled == false
  local project_directory = quarto.project.directory
  if type(project_directory) ~= "string" or project_directory == "" then
    fail("HTML extraction requires a Quarto project and prepared run manifest")
  end
  -- The environment-backed project API can corrupt Windows ANSI paths. Apply
  -- the documented ancestor offset to the native document directory, removing
  -- dot components before extended Windows paths disable OS normalization.
  local filesystem_root = pandoc.path.directory(quarto.doc.input_file)
  for component in (quarto.project.offset or "."):gsub("\\", "/"):gmatch("[^/]+") do
    if component == ".." then filesystem_root = pandoc.path.directory(filesystem_root)
    elseif component ~= "." then fail("unexpected project offset outside the document ancestry") end
  end
  local run = read_run(filesystem_root, disabled)
  if run == nil then return doc end
  local source = declared_source(run, quarto.doc.input_file, filesystem_root)
  if source == nil then return doc end
  if disabled then
    write_observation(filesystem_root, run, {
      runId = run.runId, source = source, status = "disabled", format = FORMAT
    })
    return doc
  end
  -- Other native writers still render normally. A marker prevents their
  -- unobserved HTML from being reported as a complete graph or as a failure.
  if (FORMAT ~= "html" and FORMAT ~= "html5")
      or quarto.doc.is_format("revealjs") or quarto.doc.is_format("dashboard")
      or quarto.doc.is_format("email") then
    write_observation(filesystem_root, run, {
      runId = run.runId, source = source, status = "unsupported-format", format = FORMAT
    })
    return doc
  end
  local anchors, citations = {}, {}
  local function record_anchor(element)
    if element.identifier ~= "" then
      anchors[element.identifier] = true
    end
    -- No returned replacement means the walked AST is untouched.
  end
  -- Walk only body blocks. Titles, author metadata and arbitrary private fields
  -- are never serialized. Includes are observed in their containing document;
  -- there is no invented original-file span or offset.
  doc.blocks:walk({
    Div = record_anchor,
    Header = record_anchor,
    Span = record_anchor,
    Cite = function(element)
      for _, citation in ipairs(element.citations) do
        if citation.id ~= "" then
          citations[citation.id] = true
        end
      end
    end
  })
  local observation = {
    runId = run.runId,
    source = source,
    output = pandoc.path.make_relative(quarto.doc.output_file, filesystem_root),
    status = "observed",
    format = FORMAT,
    anchors = sorted_keys(anchors),
    citations = sorted_keys(citations),
    sourcePrecision = "anchor"
  }
  if run.authoringEnabled == true then
    observation.authoring = authoring_observation(doc.blocks, doc.meta)
  end
  write_observation(filesystem_root, run, observation)
  return doc
end

return { Pandoc = observe }

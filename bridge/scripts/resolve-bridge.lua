-- CONECTIFY Bridge for DaVinci Resolve
-- Enables communication between Resolve and CONECTIFY application

local resolve = Resolve()
local projectManager = resolve:GetProjectManager()
local project = projectManager:GetCurrentProject()
local timeline = project:GetCurrentTimeline()
local mediaPool = project:GetMediaPool()

-- Utility functions for data validation
local function validateNumber(value, default)
    return type(value) == "number" and value or default
end

local function validateString(value, default)
    return type(value) == "string" and value or default
end

local function validateBoolean(value, default)
    return type(value) == "boolean" and value or default
end

-- Error handling wrapper
local function try_catch(fn)
    local status, result = pcall(fn)
    if status then
        return { success = true, data = result }
    else
        return { success = false, error = result }
    end
end

-- Get timeline data with enhanced error handling
function GetTimelineData()
    return try_catch(function()
        if not timeline then
            error("No timeline is open. Please open a timeline to continue.")
        end

        local data = {
            name = validateString(timeline:GetName(), "Untitled"),
            frameCount = validateNumber(timeline:GetTrackCount("video"), 0),
            fps = validateNumber(timeline:GetSetting("frameRate"), 24),
            resolution = {
                width = validateNumber(timeline:GetSetting("timelineResolutionWidth"), 1920),
                height = validateNumber(timeline:GetSetting("timelineResolutionHeight"), 1080)
            },
            tracks = {},
            markers = GetTimelineMarkers(),
            version = "1.0.0"
        }

        -- Get video tracks data
        for i = 1, timeline:GetTrackCount("video") do
            local trackResult = try_catch(function()
                return GetTrackData(i)
            end)
            
            if trackResult.success then
                table.insert(data.tracks, trackResult.data)
            end
        end

        return data
    end)
end

-- Get track data
function GetTrackData(index)
    local track = {
        index = index,
        type = "video",
        enabled = validateBoolean(timeline:GetIsTrackEnabled("video", index), true),
        locked = validateBoolean(timeline:GetIsTrackLocked("video", index), false),
        items = {}
    }

    local items = timeline:GetItemListInTrack("video", index)
    if items then
        for _, item in ipairs(items) do
            local itemResult = try_catch(function()
                return GetClipData(item)
            end)
            
            if itemResult.success then
                table.insert(track.items, itemResult.data)
            end
        end
    end

    return track
end

-- Get clip data
function GetClipData(item)
    if not item then error("Invalid clip item") end
    
    local mediaPoolItem = item:GetMediaPoolItem()
    return {
        id = validateString(item:GetUniqueId(), ""),
        name = validateString(item:GetName(), "Untitled Clip"),
        start = validateNumber(item:GetStart(), 0),
        endFrame = validateNumber(item:GetEnd(), 0),
        duration = validateNumber(item:GetDuration(), 0),
        mediaPoolItem = mediaPoolItem and mediaPoolItem:GetName() or nil,
        properties = GetClipProperties(item)
    }
end

-- Get timeline markers
function GetTimelineMarkers()
    return try_catch(function()
        local markers = {}
        local timelineMarkers = timeline:GetMarkers()
        
        if timelineMarkers then
            for frameId, markerInfo in pairs(timelineMarkers) do
                table.insert(markers, {
                    frameId = validateNumber(frameId, 0),
                    name = validateString(markerInfo.name, ""),
                    color = validateString(markerInfo.color, "Blue"),
                    duration = validateNumber(markerInfo.duration, 0),
                    note = validateString(markerInfo.note, "")
                })
            end
        end
        
        return markers
    end)
end

-- Get clip properties
function GetClipProperties(item)
    return try_catch(function()
        if not item then error("Invalid clip item") end
        
        return {
            transform = {
                position = { x = 0, y = 0 },
                scale = { x = 1, y = 1 },
                rotation = 0,
                opacity = 100
            },
            effects = {},
            attributes = {
                flipHorizontal = false,
                flipVertical = false,
                mute = false
            }
        }
    end)
end

-- Export timeline data
function ExportTimelineData()
    local data = GetTimelineData()
    if data.success then
        return data.data
    else
        return { error = data.error }
    end
end

-- Import timeline changes with enhanced error handling
function ImportTimelineChanges(changesPath)
    if not timeline then
        return { success = false, error = "No timeline is open" }
    end

    local file = io.open(changesPath, "r")
    if not file then
        return { success = false, error = "Cannot read changes file: " .. changesPath }
    end

    local success, changes = pcall(function()
        return JSON:decode(file:read("*all"))
    end)
    file:close()

    if not success or not changes then
        return { success = false, error = "Invalid JSON data in changes file" }
    end

    -- Apply changes to timeline with error handling
    timeline:BeginUndo("Apply CONECTIFY Changes")
    local results = { success = true, applied = 0, failed = 0, errors = {} }
    
    for _, change in ipairs(changes) do
        local success, error = pcall(function()
            local item = timeline:FindItemById(change.itemId)
            if not item then
                error("Item not found: " .. change.itemId)
            end

            if change.type == "move" then
                item:SetStart(validateNumber(change.newStart, item:GetStart()))
            elseif change.type == "trim" then
                item:SetProperty("trimIn", validateNumber(change.trimIn, 0))
                item:SetProperty("trimOut", validateNumber(change.trimOut, 0))
            elseif change.type == "transform" then
                for prop, value in pairs(change.properties) do
                    item:SetProperty(prop, validateNumber(value, 0))
                end
            end
        end)

        if success then
            results.applied = results.applied + 1
        else
            results.failed = results.failed + 1
            table.insert(results.errors, error)
        end
    end

    timeline:EndUndo()
    return results
end
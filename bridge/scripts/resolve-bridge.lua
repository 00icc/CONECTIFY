-- CONECTIFY Bridge Script for DaVinci Resolve

-- Global state management
local BridgeState = {
    connected = false,
    resolve = nil,
    fusion = nil,
    project = nil,
    lastError = nil,
    maxRetries = 3,
    retryDelay = 1,
    lastHealthCheck = 0,
    healthCheckInterval = 30,
    connectionTimeout = 10
}

-- Error handling wrapper with detailed logging
function SafeExecute(fn)
    local success, result = pcall(fn)
    if not success then
        BridgeState.lastError = result
        BridgeState.connected = false
        return { success = false, error = result, timestamp = os.time() }
    end
    return { success = true, data = result, timestamp = os.time() }
end

-- Enhanced retry operation with timeout
function RetryOperation(operation)
    local lastError
    local startTime = os.time()
    
    for attempt = 1, BridgeState.maxRetries do
        if os.time() - startTime > BridgeState.connectionTimeout then
            error("Operation timed out")
        end
        
        local result = SafeExecute(operation)
        if result.success then
            return result.data
        end
        
        lastError = result.error
        if attempt < BridgeState.maxRetries then
            bmd.wait({ seconds = BridgeState.retryDelay, frames = 0 })
        end
    end
    error(lastError)
end

-- Health check function
function CheckHealth()
    if os.time() - BridgeState.lastHealthCheck < BridgeState.healthCheckInterval then
        return BridgeState.connected
    end
    
    local result = SafeExecute(function()
        if not BridgeState.resolve or not BridgeState.project then
            return false
        end
        local projectManager = BridgeState.resolve:GetProjectManager()
        return projectManager ~= nil
    end)
    
    BridgeState.lastHealthCheck = os.time()
    BridgeState.connected = result.success
    return result.success
end

-- Enhanced connection management
function Connect()
    if BridgeState.connected and CheckHealth() then
        return true
    end
    
    return RetryOperation(function()
        BridgeState.resolve = GetResolve()
        if not BridgeState.resolve then
            error("Failed to connect to DaVinci Resolve")
        end
        
        BridgeState.project = BridgeState.resolve:GetProjectManager():GetCurrentProject()
        if not BridgeState.project then
            error("No active project found")
        end
        
        BridgeState.fusion = BridgeState.resolve:Fusion()
        if not BridgeState.fusion then
            error("Failed to initialize Fusion")
        end
        
        BridgeState.connected = true
        return true
    end)
end

-- Graceful disconnect
function Disconnect()
    BridgeState.connected = false
    BridgeState.resolve = nil
    BridgeState.fusion = nil
    BridgeState.project = nil
    BridgeState.lastError = nil
end

-- Get connection status
function GetStatus()
    return {
        connected = BridgeState.connected,
        lastError = BridgeState.lastError,
        lastHealthCheck = BridgeState.lastHealthCheck,
        timestamp = os.time()
    }
end

function GetResolve()
    local resolveInstances = {
        "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so",
        "/Applications/DaVinci Resolve Studio/DaVinci Resolve Studio.app/Contents/Libraries/Fusion/fusionscript.so"
    }
    
    return RetryOperation(function()
        for _, path in ipairs(resolveInstances) do
            if bmd.fileexists(path) then
                local resolve = bmd.scriptapp("Resolve")
                if resolve then
                    return resolve
                end
            end
        end
        error("Could not connect to DaVinci Resolve")
    end)
end

function InitializeBridge()
    return RetryOperation(function()
        local resolve = GetResolve()
        if not resolve then
            error("Could not connect to DaVinci Resolve")
        end
        
        local fusion = resolve:Fusion()
        if not fusion then
            error("Could not access Fusion page")
        end
        
        BridgeState.connected = true
        BridgeState.resolve = resolve
        BridgeState.fusion = fusion
        return resolve, fusion
    end)
end

function CreateNode(fusion, nodeType, settings)
    return RetryOperation(function()
        local comp = fusion:GetCurrentComp()
        if not comp then
            error("No composition is active")
        end
        
        local node = comp:AddTool(nodeType)
        if settings then
            for key, value in pairs(settings) do
                node:SetInput(key, value)
            end
        end
        
        return node
    end)
end

function CreateNode(nodeType, settings)
    if not BridgeState.connected then
        return { success = false, error = "Bridge not initialized" }
    end
    
    return SafeExecute(function()
        local comp = BridgeState.fusion:GetCurrentComp()
        if not comp then
            error("No composition is active")
        end
        
        local node = comp:AddTool(nodeType)
        if not node then
            error(string.format("Failed to create node of type '%s'", nodeType))
        end
    
    if settings then
        for key, value in pairs(settings) do
            local setSuccess, err = pcall(function()
                node:SetInput(key, value)
            end)
            if not setSuccess then
                error(string.format("Failed to set input '%s' on node: %s", key, err))
                return nil
            end
        end
    end
    
    return node
end

function ConnectNodes(sourceNode, destNode, sourceOutput, destInput)
    if not BridgeState.connected then
        return { success = false, error = "Bridge not initialized" }
    end
    
    return SafeExecute(function()
        if not sourceNode or not destNode then
            error("Invalid source or destination node")
        end
        
        local sourcePort = sourceNode:FindMainOutput(sourceOutput or 1)
        if not sourcePort then
            error("Source output not found")
        end
        
        local success = destNode:ConnectInput(destInput or 'Input', sourcePort)
        if not success then
            error("Failed to connect nodes")
        end
        
        return true
end

function GetNodeInputs(node)
    if not node then
        error("Invalid node")
        return nil
    end
    
    local success, inputs = pcall(function()
        return node:GetInputList()
    end)
    
    if not success then
        error(string.format("Failed to get node inputs: %s", inputs))
        return nil
    end
    
    return inputs
end

function ProcessAEData(data)
    local resolve, fusion = InitializeBridge()
    if not resolve then return false end
    
    local comp = fusion:GetCurrentComp()
    if not comp then return false end
    
    -- Process incoming After Effects data
    for _, item in ipairs(data) do
        if item.type == "transform" then
            local transform = CreateNode(fusion, "Transform", {
                Center = {item.position[1], item.position[2]},
                Size = item.scale,
                Angle = item.rotation
            })
        elseif item.type == "text" then
            local text = CreateNode(fusion, "Text+", {
                StyledText = item.content,
                Size = item.fontSize,
                Font = item.fontName
            })
        end
    end
    
    return true
end

function ExportComposition()
    local resolve, fusion = InitializeBridge()
    if not resolve then return nil end
    
    local comp = fusion:GetCurrentComp()
    if not comp then return nil end
    
    local data = {
        nodes = {},
        connections = {}
    }
    
    -- Export composition data
    local tools = comp:GetToolList()
    for _, tool in pairs(tools) do
        local nodeData = {
            name = tool:GetAttrs().TOOLS_Name,
            type = tool:GetAttrs().TOOLS_RegID,
            inputs = {}
        }
        
        -- Get input values
        local inputs = tool:GetInputList()
        for _, input in pairs(inputs) do
            nodeData.inputs[input] = tool:GetInput(input)
        end
        
        table.insert(data.nodes, nodeData)
    end
    
    return data
end

-- Event handlers for bridge communication
function OnDataReceived(data)
    if type(data) ~= "table" then
        error("Invalid data format received")
        return false
    end
    
    return ProcessAEData(data)
end

function OnExportRequest()
    local data = ExportComposition()
    if not data then
        error("Failed to export composition data")
        return nil
    end
    
    return data
end

function ProcessAEData(data)
    local resolve, fusion = InitializeBridge()
    if not resolve then return false end
    
    local comp = fusion:GetCurrentComp()
    if not comp then return false end
    
    -- Process incoming After Effects data
    for _, item in ipairs(data) do
        if item.type == "transform" then
            local transform = CreateNode(fusion, "Transform", {
                Center = {item.position[1], item.position[2]},
                Size = item.scale,
                Angle = item.rotation
            })
        elseif item.type == "text" then
            local text = CreateNode(fusion, "Text+", {
                StyledText = item.content,
                Size = item.fontSize,
                Font = item.fontName
            })
        end
    end
    
    return true
end

function ExportComposition()
    local resolve, fusion = InitializeBridge()
    if not resolve then return nil end
    
    local comp = fusion:GetCurrentComp()
    if not comp then return nil end
    
    local data = {
        nodes = {},
        connections = {}
    }
    
    -- Export composition data
    local tools = comp:GetToolList()
    for _, tool in pairs(tools) do
        local nodeData = {
            name = tool:GetAttrs().TOOLS_Name,
            type = tool:GetAttrs().TOOLS_RegID,
            inputs = {}
        }
        
        -- Get input values
        local inputs = tool:GetInputList()
        for _, input in pairs(inputs) do
            nodeData.inputs[input] = tool:GetInput(input)
        end
        
        table.insert(data.nodes, nodeData)
    end
    
    return data
end

-- Event handlers for bridge communication
function OnDataReceived(data)
    if type(data) ~= "table" then
        error("Invalid data format received")
        return false
    end
    
    return ProcessAEData(data)
end

function OnExportRequest()
    local data = ExportComposition()
    if not data then
        error("Failed to export composition data")
        return nil
    end
    
    return data
end
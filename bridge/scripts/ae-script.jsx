// Error handling wrapper
function try_catch(fn) {
    try {
        return { success: true, data: fn() };
    } catch (e) {
        return { success: false, error: e.toString() };
    }
}

// Validate numeric value
function validateNumber(value, defaultValue) {
    return (typeof value === 'number' && !isNaN(value)) ? value : defaultValue;
}

// Get the active composition
var result = try_catch(function() {
    var activeComp = app.project.activeItem;
    if (!activeComp || !(activeComp instanceof CompItem)) {
        throw new Error('No active composition');
    }
    var compData = {
        name: activeComp.name,
        duration: activeComp.duration,
        frameRate: activeComp.frameRate,
        width: activeComp.width,
        height: activeComp.height,
        layers: []
    };
    
    // Iterate through all layers in the composition
    for (var i = 1; i <= activeComp.numLayers; i++) {
        var layerResult = try_catch(function() {
            var layer = activeComp.layer(i);
            return {
                id: i,
                name: layer.name,
                type: getLayerType(layer),
                enabled: layer.enabled,
                solo: layer.solo,
                shy: layer.shy,
                locked: layer.locked,
                inPoint: validateNumber(layer.inPoint, 0),
                outPoint: validateNumber(layer.outPoint, activeComp.duration),
                startTime: validateNumber(layer.startTime, 0),
                properties: extractLayerProperties(layer)
            };
        });
        
        if (layerResult.success) {
            compData.layers.push(layerResult.data);
        } else {
            compData.layers.push({
                id: i,
                error: layerResult.error
            });
        }
    }
    
    return compData;
});

// Output the result as JSON
if (result.success) {
    $.writeln(JSON.stringify(result.data));
} else {
    $.writeln(JSON.stringify([]));
}

function getLayerType(layer) {
    if (layer instanceof ShapeLayer) return 'shape';
    if (layer instanceof TextLayer) return 'text';
    if (layer instanceof AVLayer) {
        if (layer.source instanceof CompItem) return 'composition';
        if (layer.source instanceof FootageItem) {
            if (layer.source.mainSource instanceof SolidSource) return 'solid';
            if (layer.source.mainSource instanceof FileSource) {
                return layer.source.mainSource.isStill ? 'image' : 'video';
            }
        }
    }
    return 'unknown';
}

function extractLayerProperties(layer) {
    var props = {};
    
    // Extract transform properties with validation
    var transformProps = ['position', 'scale', 'rotation', 'opacity', 'anchorPoint'];
    transformProps.forEach(function(prop) {
        var result = try_catch(function() {
            var transform = layer.transform[prop];
            var value = transform.numKeys > 0 ? transform.valueAtTime(0, false) : transform.value;
            return Array.isArray(value) ? value.map(function(v) { return validateNumber(v, 0); }) : validateNumber(value, 0);
        });
        props[prop] = result.success ? result.data : null;
    });
    
    // Extract effects
    if (layer.effect && layer.effect.numProperties > 0) {
        props.effects = [];
        for (var i = 1; i <= layer.effect.numProperties; i++) {
            var effectResult = try_catch(function() {
                var effect = layer.effect(i);
                return {
                    name: effect.name,
                    matchName: effect.matchName,
                    enabled: effect.enabled
                };
            });
            if (effectResult.success) {
                props.effects.push(effectResult.data);
            }
        }
    }
    
    // Layer-specific properties with validation
    if (layer instanceof TextLayer) {
        var textResult = try_catch(function() {
            var textDocument = layer.text.sourceText.value;
            return {
                text: textDocument.text,
                fontSize: validateNumber(textDocument.fontSize, 12),
                font: textDocument.font,
                fillColor: textDocument.fillColor,
                strokeColor: textDocument.strokeColor,
                strokeWidth: validateNumber(textDocument.strokeWidth, 0),
                tracking: validateNumber(textDocument.tracking, 0)
            };
        });
        if (textResult.success) {
            props.textProperties = textResult.data;
        }
    } else if (layer instanceof ShapeLayer) {
        var shapeResult = try_catch(function() {
            var shapeContents = [];
            for (var i = 1; i <= layer.content.numProperties; i++) {
                var shape = layer.content.property(i);
                shapeContents.push({
                    name: shape.name,
                    matchName: shape.matchName,
                    type: shape.propertyType
                });
            }
            return shapeContents;
        });
        if (shapeResult.success) {
            props.shapeContents = shapeResult.data;
        }
    }
    
    return props;
}
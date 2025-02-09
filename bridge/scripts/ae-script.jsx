// CONECTIFY Bridge for After Effects
// Enables communication between After Effects and CONECTIFY application

// Error handling wrapper
function try_catch(fn) {
    try {
        return { success: true, data: fn() };
    } catch (e) {
        return { success: false, error: e.toString() };
    }
}

// Utility functions for data validation
function validateNumber(value, defaultValue) {
    return (typeof value === 'number' && !isNaN(value)) ? value : defaultValue;
}

function validateString(value, defaultValue) {
    return (typeof value === 'string') ? value : defaultValue;
}

function validateBoolean(value, defaultValue) {
    return (typeof value === 'boolean') ? value : defaultValue;
}

// Get composition data
function getCompositionData() {
    return try_catch(function() {
        var activeComp = app.project.activeItem;
        if (!activeComp || !(activeComp instanceof CompItem)) {
            throw new Error('No active composition');
        }

        return {
            name: validateString(activeComp.name, 'Untitled'),
            duration: validateNumber(activeComp.duration, 0),
            frameRate: validateNumber(activeComp.frameRate, 24),
            width: validateNumber(activeComp.width, 1920),
            height: validateNumber(activeComp.height, 1080),
            layers: getLayersData(activeComp),
            markers: getCompMarkers(activeComp),
            version: '1.0.0'
        };
    });
}

// Get layers data
function getLayersData(comp) {
    var layers = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        var layerResult = try_catch(function() {
            var layer = comp.layer(i);
            return {
                id: validateNumber(i, 0),
                name: validateString(layer.name, 'Untitled Layer'),
                type: getLayerType(layer),
                enabled: validateBoolean(layer.enabled, true),
                solo: validateBoolean(layer.solo, false),
                locked: validateBoolean(layer.locked, false),
                inPoint: validateNumber(layer.inPoint, 0),
                outPoint: validateNumber(layer.outPoint, comp.duration),
                startTime: validateNumber(layer.startTime, 0),
                properties: getLayerProperties(layer)
            };
        });

        if (layerResult.success) {
            layers.push(layerResult.data);
        }
    }
    return layers;
}

// Get layer type
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

// Get layer properties
function getLayerProperties(layer) {
    return try_catch(function() {
        var transform = layer.transform;
        return {
            transform: {
                position: getPropertyValue(transform.position),
                scale: getPropertyValue(transform.scale),
                rotation: validateNumber(getPropertyValue(transform.rotation), 0),
                opacity: validateNumber(getPropertyValue(transform.opacity), 100),
                anchorPoint: getPropertyValue(transform.anchorPoint)
            },
            effects: getEffectsData(layer),
            masks: getMasksData(layer)
        };
    }).data || {};
}

// Get property value
function getPropertyValue(property) {
    if (!property) return null;
    var value = property.numKeys > 0 ? property.valueAtTime(0, false) : property.value;
    return Array.isArray(value) ? value.map(function(v) { return validateNumber(v, 0); }) : validateNumber(value, 0);
}

// Get effects data
function getEffectsData(layer) {
    var effects = [];
    if (layer.effect && layer.effect.numProperties > 0) {
        for (var i = 1; i <= layer.effect.numProperties; i++) {
            var effectResult = try_catch(function() {
                var effect = layer.effect(i);
                return {
                    name: validateString(effect.name, 'Untitled Effect'),
                    matchName: validateString(effect.matchName, ''),
                    enabled: validateBoolean(effect.enabled, true)
                };
            });

            if (effectResult.success) {
                effects.push(effectResult.data);
            }
        }
    }
    return effects;
}

// Get composition markers
function getCompMarkers(comp) {
    var markers = [];
    if (comp.markerProperty && comp.markerProperty.numKeys > 0) {
        for (var i = 1; i <= comp.markerProperty.numKeys; i++) {
            var markerResult = try_catch(function() {
                var marker = comp.markerProperty.keyValue(i);
                return {
                    time: validateNumber(comp.markerProperty.keyTime(i), 0),
                    name: validateString(marker.comment, ''),
                    duration: validateNumber(marker.duration, 0),
                    chapter: validateString(marker.chapter, ''),
                    url: validateString(marker.url, '')
                };
            });

            if (markerResult.success) {
                markers.push(markerResult.data);
            }
        }
    }
    return markers;
}

// Export composition data
var result = getCompositionData();
if (result.success) {
    $.writeln(JSON.stringify(result.data));
} else {
    $.writeln(JSON.stringify({ error: result.error }));
}
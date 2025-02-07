const Joi = require('joi')
const sanitizeHtml = require('sanitize-html')

// Schema definitions for IPC input validation
const schemas = {
  'check-installation': Joi.object().keys({
    forceRescan: Joi.boolean().default(false)
  }).unknown(false),

  'get-paths': Joi.object().keys({}).unknown(false),

  'save-paths': Joi.object().keys({
    aePath: Joi.string().uri({ allowRelative: true }).required(),
    resolvePath: Joi.string().uri({ allowRelative: true }).required()
  }),

  'bridge-operation': Joi.object().keys({
    action: Joi.string().valid('start', 'stop').required(),
    options: Joi.object().keys({
      timeout: Joi.number().min(1000).max(30000)
    })
  }),

  'configure-app': Joi.object().keys({
    app: Joi.string().valid('after-effects', 'davinci-resolve').required(),
    settings: Joi.object().required()
  }),

  'get-bridge-status': Joi.object().keys({}).unknown(false)
}

function validateIpcInput(channel, input) {
  // Sanitize input first
  const sanitized = sanitizeInput(input)
  
  // Validate against schema
  const schema = schemas[channel]
  if (!schema) {
    throw new Error(`No validation schema for channel: ${channel}`)
  }

  const { error, value } = schema.validate(sanitized)
  if (error) {
    error.code = 'VALIDATION_ERROR'
    throw error
  }

  return value
}

function sanitizeInput(obj) {
  // Recursively sanitize string values
  const sanitizer = (value) => {
    if (typeof value === 'string') {
      return sanitizeHtml(value, {
        allowedTags: [],
        allowedAttributes: {}
      }).trim()
    }
    return value
  }

  return deepMap(obj, sanitizer)
}

function deepMap(obj, fn) {
  if (Array.isArray(obj)) {
    return obj.map(v => deepMap(v, fn))
  } else if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, deepMap(v, fn)])
    )
  }
  return fn(obj)
}

module.exports = {
  validateIpcInput
}

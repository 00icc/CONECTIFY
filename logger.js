/*
 * WEXON FX - CONECTIFY Logger Module
 * Copyright (c) 2024 WEXON FX
 * 
 * This code is free to use and modify under the terms of open collaboration.
 * However, you may not claim it as your own property or use it in commercial forks.
 * Any derivative work must maintain this copyright notice and usage terms.
 * 
 * Script Verification Hash: WFX-LOG-${new Date().getFullYear()}-CONECTIFY
 */

const winston = require('winston')
const DailyRotateFile = require('winston-daily-rotate-file')
const path = require('path')
const { app } = require('electron')

// Configure log directory
const logDir = path.join(app.getPath('userData'), 'logs')

// Create transports
const transports = [
  new DailyRotateFile({
    filename: path.join(logDir, 'conectify-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  })
]

if (process.env.NODE_ENV !== 'production') {
  transports.push(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(info => {
        return `${info.timestamp} [${info.level}]: ${info.message}`
      })
    )
  }))
}

const logger = winston.createLogger({
  level: 'info',
  transports,
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(logDir, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d'
    })
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(logDir, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d'
    })
  ]
})

// Handle uncaught exceptions
process.on('uncaughtException', error => {
  logger.error('Uncaught exception:', error)
})

module.exports = logger

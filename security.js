/*
 * WEXON FX - CONECTIFY Security Module
 * Copyright (c) 2024 WEXON FX
 * 
 * This code is free to use and modify under the terms of open collaboration.
 * However, you may not claim it as your own property or use it in commercial forks.
 * Any derivative work must maintain this copyright notice and usage terms.
 * 
 * Script Verification Hash: WFX-SEC-${new Date().getFullYear()}-CONECTIFY
 */

const crypto = require('crypto');
const logger = require('./logger');
const { execSync } = require('child_process');

// Key management constants
const KEY_SERVICE = 'ConectifySecurity';
const KEY_ACCOUNT = 'encryption-key';
const KEY_LENGTH = 32; // 256-bit key
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey() {
  try {
    // Try to retrieve from Keychain
    const key = execSync(
      `security find-generic-password -s "${KEY_SERVICE}" -a "${KEY_ACCOUNT}" -w`
    ).toString().trim();
    
    if (key && key.length === KEY_LENGTH) {
      return Buffer.from(key, 'hex');
    }
  } catch (error) {
    logger.warn('Keychain key not found, generating new key');
  }

  // Generate new key and store in Keychain
  const newKey = crypto.randomBytes(KEY_LENGTH);
  execSync(
    `security add-generic-password -s "${KEY_SERVICE}" -a "${KEY_ACCOUNT}" ` +
    `-w "${newKey.toString('hex')}" -U`,
    { stdio: 'ignore' }
  );
  
  return newKey;
}

const encryptionKey = getEncryptionKey();

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedText) {
  const [ivHex, authTagHex, encryptedHex] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, null, 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

function rotateKeys() {
  try {
    // Delete existing key
    execSync(
      `security delete-generic-password -s "${KEY_SERVICE}" -a "${KEY_ACCOUNT}"`,
      { stdio: 'ignore' }
    );
  } catch (error) {
    logger.error('Key rotation failed:', error);
  }
  getEncryptionKey(); // Generate new key
}

module.exports = {
  encrypt,
  decrypt,
  rotateKeys
};
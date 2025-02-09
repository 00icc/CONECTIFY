import { invoke } from '@tauri-apps/api/tauri';

// Error types matching Rust backend
export class BridgeError extends Error {
    constructor(type, message) {
        super(message);
        this.type = type;
        this.name = 'BridgeError';
    }
}

// Button state management
export const setButtonState = (button, isEnabled, text = null) => {
    if (!button) return;
    button.disabled = !isEnabled;
    if (text) button.textContent = text;
};

// Status message display with error handling
export const setStatus = (element, message, type = 'success') => {
    if (!element) return;
    if (message instanceof BridgeError) {
        element.textContent = `Error: ${message.message}`;
        element.className = 'status error';
    } else {
        element.textContent = message;
        element.className = `status ${type}`;
    }
    element.style.display = message ? 'block' : 'none';
};

// Enhanced path validation
export const validatePath = async (path, appType) => {
    if (!path) return false;
    try {
        return await invoke('validate_path', { path, app_type: appType });
    } catch (error) {
        throw new BridgeError('Validation', error.message);
    }
};

// Error handling wrapper with status updates
export const handleAsyncOperation = async (operation, statusElement, successMessage) => {
    try {
        const result = await operation();
        setStatus(statusElement, successMessage, 'success');
        return result;
    } catch (error) {
        const bridgeError = error instanceof BridgeError ? error : 
            new BridgeError('Operation', error.message);
        setStatus(statusElement, bridgeError);
        throw bridgeError;
    }
};

// Input validation with error handling
export const validateInput = async (input, statusElement, appType) => {
    if (!input.value.trim()) {
        throw new BridgeError('Validation', 'Path cannot be empty');
    }
    
    const isValid = await validatePath(input.value, appType);
    if (!isValid) {
        throw new BridgeError('Validation', 'Invalid path format');
    }
    
    return true;
};

// Status management for async operations
export const createStatusManager = (statusElement) => ({
    setLoading: (message) => setStatus(statusElement, message, 'loading'),
    setSuccess: (message) => setStatus(statusElement, message, 'success'),
    setError: (error) => setStatus(statusElement, error),
    clear: () => setStatus(statusElement, '')
});
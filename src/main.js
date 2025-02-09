import { invoke } from '@tauri-apps/api/tauri';
import { applyTheme, getPreferredTheme, showNotification } from './theme.js';
import bridgeService from './services/bridgeService.js';

// Error handling utility
const handleError = (error, statusElement = null) => {
    const errorMessage = error.message || 'An unknown error occurred';
    console.error(error);
    
    if (statusElement) {
        statusElement.textContent = `Error: ${errorMessage}`;
        statusElement.className = 'status error';
    }
    
    showNotification(errorMessage, 5000);
};

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Initialize theme
        applyTheme(getPreferredTheme());

        // Load saved paths
        const paths = await bridgeService.getConfig();
        document.getElementById('aePath').value = paths.ae_path || '';
        document.getElementById('resolvePath').value = paths.resolve_path || '';

        // Add input validation handlers
        document.getElementById('aePath').addEventListener('blur', validatePath);
        document.getElementById('resolvePath').addEventListener('blur', validatePath);

        // Setup all handlers
        setupBridgeOperations();
        setupConfigurationHandlers();
        setupPathHandlers();

    } catch (error) {
        handleError(error);
    }
});

function setupBridgeOperations() {
    const startBridge = document.getElementById('startBridge');
    const stopBridge = document.getElementById('stopBridge');
    const bridgeStatus = document.getElementById('bridgeStatus');

    startBridge.addEventListener('click', async () => {
        try {
            bridgeStatus.textContent = 'Starting bridge...';
            bridgeStatus.className = 'status';
            startBridge.disabled = true;
            
            await bridgeService.startBridge();
            bridgeStatus.textContent = 'Bridge started successfully';
            bridgeStatus.className = 'status success';
            stopBridge.disabled = false;
            showNotification('Bridge started successfully');
        } catch (error) {
            handleError(error, bridgeStatus);
            startBridge.disabled = false;
        }
    });


    stopBridge.addEventListener('click', async () => {
        try {
            bridgeStatus.textContent = 'Stopping bridge...';
            bridgeStatus.className = 'status';
            stopBridge.disabled = true;
            
            await bridgeService.stopBridge();
            bridgeStatus.textContent = 'Bridge stopped';
            bridgeStatus.className = 'status';
            startBridge.disabled = false;
            showNotification('Bridge stopped successfully');
        } catch (error) {
            handleError(error, bridgeStatus);
            startBridge.disabled = false;
            stopBridge.disabled = false;
        }
    });
}


    function setupConfigurationHandlers() {
        const settingsStatus = document.getElementById('settingsStatus');

        document.getElementById('configureAE').addEventListener('click', async () => {
            try {
                settingsStatus.textContent = 'Configuring After Effects...';
                settingsStatus.className = 'status';
                
                await invoke('configure_app', { app: 'ae' });
                settingsStatus.textContent = 'After Effects configured successfully';
                settingsStatus.className = 'status success';
                showNotification('After Effects configured successfully');
            } catch (error) {
                handleError(error, settingsStatus);
            }
        });

        document.getElementById('configureResolve').addEventListener('click', async () => {
            try {
                settingsStatus.textContent = 'Configuring DaVinci Resolve...';
                settingsStatus.className = 'status';
                
                await invoke('configure_app', { app: 'resolve' });
                settingsStatus.textContent = 'DaVinci Resolve configured successfully';
                settingsStatus.className = 'status success';
                showNotification('DaVinci Resolve configured successfully');
            } catch (error) {
                handleError(error, settingsStatus);
            }
        });
    }

    function setupPathHandlers() {
        const pathStatus = document.getElementById('pathStatus');

        document.getElementById('testConnection').addEventListener('click', async () => {
            try {
                const aePath = document.getElementById('aePath').value;
                const resolvePath = document.getElementById('resolvePath').value;
                
                await invoke('test_connections', { ae: aePath, resolve: resolvePath });
                showNotification('All connections verified successfully');
            } catch (error) {
                handleError(error, pathStatus);
            }
        });

        document.getElementById('savePaths').addEventListener('click', async () => {
            try {
                const aePath = document.getElementById('aePath').value;
                const resolvePath = document.getElementById('resolvePath').value;

                if (!aePath || !resolvePath) {
                    throw new Error('Please fill in both paths');
                }

                pathStatus.textContent = 'Validating paths...';
                pathStatus.className = 'status';

                const [aeValid, resolveValid] = await Promise.all([
                    invoke('validate_path', { path: aePath, app_type: 'ae' }),
                    invoke('validate_path', { path: resolvePath, app_type: 'resolve' })
                ]);

                if (!aeValid || !resolveValid) {
                    throw new Error('One or more paths are invalid');
                }

                pathStatus.textContent = 'Saving paths...';
                await invoke('save_config', { 
                    ae_path: aePath, 
                    resolve_path: resolvePath 
                });

                pathStatus.textContent = 'Paths saved successfully';
                pathStatus.className = 'status success';
                showNotification('Paths saved successfully');
            } catch (error) {
                handleError(error, pathStatus);
            }
        });
    }

});

async function validatePath(e) {
    const path = e.target.value;
    try {
        const isValid = await invoke('validate_path', { 
            path,
            app_type: e.target.id === 'aePath' ? 'ae' : 'resolve'
        });
        e.target.style.borderColor = isValid ? 'var(--status-success-text)' : 'var(--status-error-text)';
    } catch (error) {
        handleError(error);
        e.target.style.borderColor = 'var(--status-error-text)';
    }
}

import { BridgeError } from './utils.js';

// Theme management
const themeToggle = document.getElementById('themeToggle');
const notification = document.getElementById('notification');

// Theme-related errors
const ThemeError = {
    STORAGE: 'storage',
    APPLY: 'apply',
    SYSTEM: 'system'
};

// Check for saved theme preference or use system preference
const getPreferredTheme = () => {
    try {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            return savedTheme;
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (error) {
        throw new BridgeError(ThemeError.STORAGE, 'Failed to get theme preference');
    }
};

// Apply theme with error handling
const applyTheme = (theme) => {
    try {
        if (!['dark', 'light'].includes(theme)) {
            throw new Error('Invalid theme value');
        }
        
        document.documentElement.setAttribute('data-theme', theme);
        themeToggle.checked = theme === 'dark';
        localStorage.setItem('theme', theme);
    } catch (error) {
        throw new BridgeError(ThemeError.APPLY, `Failed to apply theme: ${error.message}`);
    }
};

// Enhanced notification system
const showNotification = (message, duration = 3000, type = 'info') => {
    try {
        notification.textContent = message;
        notification.style.display = 'block';
        notification.className = `notification ${type}`;
        notification.classList.remove('show');
        
        // Force a reflow to ensure the transition works
        notification.offsetHeight;
        
        requestAnimationFrame(() => {
            notification.classList.add('show');
            
            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => {
                    notification.style.display = 'none';
                }, 300);
            }, duration);
        });
    } catch (error) {
        console.error('Notification error:', error);
    }
};

// Initialize theme with error handling
try {
    applyTheme(getPreferredTheme());
} catch (error) {
    console.error('Theme initialization error:', error);
    // Fallback to light theme
    applyTheme('light');
}

// Handle theme toggle with error handling
themeToggle.addEventListener('change', (e) => {
    try {
        const newTheme = e.target.checked ? 'dark' : 'light';
        applyTheme(newTheme);
        showNotification(`${newTheme.charAt(0).toUpperCase() + newTheme.slice(1)} mode enabled`);
    } catch (error) {
        showNotification(error.message, 5000, 'error');
    }
});

// Handle system theme changes with error handling
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    try {
        if (!localStorage.getItem('theme')) {
            const newTheme = e.matches ? 'dark' : 'light';
            applyTheme(newTheme);
        }
    } catch (error) {
        showNotification(error.message, 5000, 'error');
    }
});

export { applyTheme, getPreferredTheme, showNotification };


const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const copyFile = promisify(fs.copyFile);
const mkdir = promisify(fs.mkdir);

class BridgeInstaller {
    constructor() {
        this.scriptsPath = path.join(__dirname);
    }

    async installAfterEffects(aePath) {
        try {
            const aeScriptsPath = path.join(aePath, 'Support Files', 'Scripts');
            await this.ensureDirectoryExists(aeScriptsPath);
            
            // Copy AE bridge files
            await copyFile(
                path.join(this.scriptsPath, 'ae-script.jsx'),
                path.join(aeScriptsPath, 'CONECTIFY.jsx')
            );

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async installResolve(resolvePath) {
        try {
            const resolveScriptsPath = path.join(resolvePath, 'Fusion', 'Scripts');
            await this.ensureDirectoryExists(resolveScriptsPath);

            // Copy Resolve bridge files
            await copyFile(
                path.join(this.scriptsPath, 'resolve-bridge.lua'),
                path.join(resolveScriptsPath, 'CONECTIFY.lua')
            );

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async ensureDirectoryExists(dirPath) {
        try {
            await mkdir(dirPath, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    async validateInstallation(app, appPath) {
        try {
            const scriptsPath = app === 'ae' ?
                path.join(appPath, 'Support Files', 'Scripts', 'CONECTIFY.jsx') :
                path.join(appPath, 'Fusion', 'Scripts', 'CONECTIFY.lua');

            await fs.promises.access(scriptsPath);
            return true;
        } catch {
            return false;
        }
    }
}

module.exports = BridgeInstaller;
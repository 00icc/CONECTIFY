import { platform } from '@tauri-apps/api/os';
import { invoke } from '@tauri-apps/api/tauri';
import { supabaseService } from './supabaseService';

class PathService {
    constructor() {
        this.paths = {
            ae_path: null,
            resolve_path: null
        };
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            // Get the current OS platform
            const currentPlatform = await platform();
            
            // Try to load paths from Supabase
            const { data, error } = await supabaseService.supabase
                .from('application_paths')
                .select('*')
                .eq('platform', currentPlatform)
                .single();

            if (data) {
                this.paths = {
                    ae_path: data.ae_path,
                    resolve_path: data.resolve_path
                };
            } else {
                // If no paths are stored, try to auto-detect them
                await this.autoDetectPaths();
            }

            this.initialized = true;
        } catch (error) {
            console.error('Error initializing path service:', error);
            throw error;
        }
    }

    async autoDetectPaths() {
        try {
            // Use Tauri to detect installation paths
            const detectedPaths = await invoke('detect_application_paths');
            this.paths = detectedPaths;

            // Save detected paths to Supabase
            await this.savePaths(detectedPaths);
        } catch (error) {
            console.error('Error auto-detecting paths:', error);
            // Don't throw here - just log the error and continue
        }
    }

    async savePaths(paths) {
        try {
            const currentPlatform = await platform();
            const { error } = await supabaseService.supabase
                .from('application_paths')
                .upsert({
                    platform: currentPlatform,
                    ae_path: paths.ae_path,
                    resolve_path: paths.resolve_path,
                    updated_at: new Date().toISOString()
                });

            if (error) throw error;
            this.paths = paths;
        } catch (error) {
            console.error('Error saving paths:', error);
            throw error;
        }
    }

    async getPaths() {
        if (!this.initialized) {
            await this.initialize();
        }
        return this.paths;
    }

    async validatePath(path, application) {
        try {
            return await invoke('validate_application_path', {
                path,
                application
            });
        } catch (error) {
            console.error(`Error validating ${application} path:`, error);
            return false;
        }
    }
}

export const pathService = new PathService();
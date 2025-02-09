import { createClient } from '@supabase/supabase-js';

class SupabaseService {
    constructor() {
        this.supabase = null;
        this.initialized = false;
    }

    initialize(supabaseUrl, supabaseKey) {
        if (this.initialized) return;

        this.supabase = createClient(supabaseUrl, supabaseKey);
        this.initialized = true;
    }

    async signUp(email, password) {
        try {
            const { data, error } = await this.supabase.auth.signUp({
                email,
                password
            });
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error signing up:', error.message);
            throw error;
        }
    }

    async signIn(email, password) {
        try {
            const { data, error } = await this.supabase.auth.signInWithPassword({
                email,
                password
            });
            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error signing in:', error.message);
            throw error;
        }
    }

    async signOut() {
        try {
            const { error } = await this.supabase.auth.signOut();
            if (error) throw error;
        } catch (error) {
            console.error('Error signing out:', error.message);
            throw error;
        }
    }

    async getUser() {
        try {
            const { data: { user }, error } = await this.supabase.auth.getUser();
            if (error) throw error;
            return user;
        } catch (error) {
            console.error('Error getting user:', error.message);
            throw error;
        }
    }

    async subscribeToChanges(table, callback) {
        try {
            const subscription = this.supabase
                .channel('db_changes')
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table },
                    (payload) => callback(payload)
                )
                .subscribe();
            return subscription;
        } catch (error) {
            console.error('Error subscribing to changes:', error.message);
            throw error;
        }
    }
}

export const supabaseService = new SupabaseService();
import { SupabaseStorage } from './supabase-storage';

const storage = new SupabaseStorage();

export interface ClientPreferences {
  budget?: string; // e.g. "500-1000 USD"
  zone?: string;   // e.g. "Lomas de Zamora"
  type?: string;   // e.g. "Casa", "Depto"
  rooms?: number;
  transactionType?: 'venta' | 'alquiler';
}

export async function syncClientMemory(userId: string, newPreferences: ClientPreferences) {
    console.log(`Syncing memory for user ${userId}:`, newPreferences);
    
    // Fetch existing profile to merge
    const existing = await storage.getProfile(userId);
    const currentPrefs = existing?.preferences || {};

    // Basic merge strategy: new values overwrite old ones only if defined
    const mergedPrefs = {
        ...currentPrefs,
        ...Object.fromEntries(Object.entries(newPreferences).filter(([_, v]) => v !== undefined && v !== null))
    };

    await storage.updateProfile(userId, mergedPrefs);
    console.log(`Memory synced for ${userId}`);
}

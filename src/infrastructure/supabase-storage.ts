import { supabase } from '../lib/supabase-client';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  created_at: string;
}

export class SupabaseStorage {
  async saveMessage(sessionId: string, role: ChatRole, content: string) {
    const { error } = await supabase
      .from('chat_messages')
      .insert({ session_id: sessionId, role, content });

    if (error) {
      console.error('Error saving message:', error);
      throw error;
    }
  }

  async getLastMessages(sessionId: string, limit: number = 10): Promise<ChatMessage[]> {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching messages:', error);
      throw error;
    }

    return (data || []).reverse() as ChatMessage[];
  }

  async getProfile(userId: string) {
    const { data, error } = await supabase
      .from('client_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is 'not found'
      console.error('Error fetching profile:', error);
    }

    return data;
  }

  async updateProfile(userId: string, preferences: any, summary?: string) {
    const updateData: any = { preferences, last_interaction: new Date().toISOString() };
    if (summary) updateData.summary = summary;

    const { error } = await supabase
      .from('client_profiles')
      .upsert({ user_id: userId, ...updateData }, { onConflict: 'user_id' });

    if (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
  }

  async createSession(userId: string, metadata: any = {}) {
    const { data, error } = await supabase
      .from('chat_sessions')
      .insert({ user_id: userId, metadata })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating session', error);
      throw error;
    }
    return data;
  }

  async searchProperties(embedding: number[], threshold: number = 0.7, limit: number = 5) {
    const { data, error } = await supabase.rpc('match_property_memory', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: limit,
    });

    if (error) {
      console.error('Error searching properties:', error);
      throw error;
    }

    return data;
  }
}

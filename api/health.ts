import { withSupabase } from '@supabase/server';

export const config = { runtime: 'edge' };

export default withSupabase({ auth: 'none' }, async () => {
  return Response.json({ status: 'ok' });
});

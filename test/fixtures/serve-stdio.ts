import { serve } from 'contextjsx/serve';
import { app } from './sample-app';

const { done, close } = await serve(app, 'stdio');
await done;
await close();
console.error('closed after stdin ended');

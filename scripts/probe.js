// Explicit developer-only compatibility check. No task IDs/content are printed.
const {CodexClient}=require('../src/rpc');
const {checkConnection}=require('../src/connection');
(async()=>{const client=new CodexClient();try{await client.start();await checkConnection(client.request.bind(client));console.log('Connection, account and required pagination: PASS');}finally{client.stop();}})().catch(()=>{console.error('Compatibility check failed. Check Codex installation, login and experimental paging support.');process.exitCode=1;});

// Install test clients only: npm install --prefix output/pet-mcp-client @modelcontextprotocol/client @modelcontextprotocol/sdk
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
const require = createRequire(resolve('output/pet-mcp-client/package.json'))
const executable = resolve(process.argv[2] || 'src-tauri/target/debug/markflow.exe')
const liveDirectory = process.argv[3]
const temporary = await mkdtemp(join(tmpdir(),'markflow-mcp-'))
for (const version of [1,2]) {
  const clientModule = version === 1 ? '@modelcontextprotocol/sdk/client/index.js' : '@modelcontextprotocol/client'
  const stdioModule = version === 1 ? '@modelcontextprotocol/sdk/client/stdio.js' : '@modelcontextprotocol/client/stdio'
  const {Client} = await import(pathToFileURL(require.resolve(clientModule)))
  const {StdioClientTransport} = await import(pathToFileURL(require.resolve(stdioModule)))
  const client = new Client({name:'markflow-compatibility-check',version:'1.0.0'})
  const transport = new StdioClientTransport({command:executable,args:['--pet-mcp','--data-dir',liveDirectory || temporary],stderr:'pipe'})
  try {
    await client.connect(transport)
    assert.equal(client.getServerVersion().name,'markflow-pet')
    const {tools} = await client.listTools()
    assert.equal(tools.length,11)
    assert.equal(new Set(tools.map(t=>t.name)).size,11)
    const call = (name,args={}) => client.callTool({name,arguments:args})
    const schema = await call('pet_get_schema')
    assert.equal(schema.isError,false); assert.equal(schema.structuredContent.template.version,1)
    const brief = await call('pet_prepare_generation',{description:'圆润的蓝色小机器人',mode:'sprite'})
    assert.match(brief.structuredContent.brief,/1024/)
    await assert.rejects(call('pet_configure',{id:'dsh-blue',settings:{scale:100}}))
    await assert.rejects(call('pet_say',{text:'hello',execute:'calc.exe'}))
    await assert.rejects(call('does_not_exist'))
    if (!liveDirectory) {
      const offline = await call('pet_get_state'); assert.equal(offline.isError,true)
    } else if (process.argv.includes('--disabled')) {
      const disabled = await call('pet_get_state'); assert.equal(disabled.isError,true); assert.match(disabled.content[0].text,/开启/)
    } else {
      const before = await call('pet_get_state'); assert.equal(before.isError,false)
      const id = `mcp-qa-v${version}`
      const result = await call('pet_create_from_image',{path:resolve('public/pets/dsh-blue/poster.png'),name:`MCP 图片验证 ${version}`,id})
      assert.equal(result.isError,false,JSON.stringify(result)); assert.equal(result.structuredContent.id,id)
      const duplicate = await call('pet_create_from_image',{path:resolve('public/pets/dsh-blue/poster.png'),name:'重复',id})
      assert.equal(duplicate.isError,true)
      const selected = await call('pet_configure',{id,settings:{scale:.8,opacity:.9,greeting:'来自 MCP 的自定义宠物'}})
      assert.equal(selected.structuredContent.pet.id,id)
      const partial = await call('pet_configure',{id,settings:{flip:true}})
      assert.equal(partial.structuredContent.settings.scale,.8,'partial settings preserve earlier values')
      assert.equal(partial.structuredContent.settings.flip,true)
      const said = await call('pet_say',{text:'MCP 已连接，自定义宠物测试成功。',action:'idle'})
      assert.equal(said.structuredContent.status,'queued')
      const unavailable = await call('pet_play',{action:'not-defined'}); assert.equal(unavailable.isError,true)
      await call('pet_configure',{id:before.structuredContent.pet.id,settings:before.structuredContent.settings})
      const listed = await call('pet_list'); assert.ok(listed.structuredContent.pets.some(p=>p.id===id))
    }
    console.log(`Official MCP SDK v${version}: handshake, discovery, schema, generation brief, input validation, ${liveDirectory ? process.argv.includes('--disabled')?'disabled control':'live import/configure/speech' : 'offline failure'} passed`)
  } finally { await client.close() }
}
await rm(temporary,{recursive:true})

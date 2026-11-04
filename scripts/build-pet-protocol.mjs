import { mkdir, writeFile } from 'node:fs/promises'
const string = (maxLength = 300) => ({ type: 'string', minLength: 1, maxLength })
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum })
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum })
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const sprite = object({ columns: integer(1,32), rows: integer(1,32), frames: integer(1,1024), fps: number(1,60) }, ['columns','rows','frames','fps'])
const settings = object({ scale:number(.5,1.5), opacity:number(.3,1), speed:number(.5,2), flip:{type:'boolean'}, bubbleColor:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}, idleChat:{type:'boolean'}, greeting:{type:'string',maxLength:300} })
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'MarkFlow Pet Package v1',
  ...object({ version:{const:1,type:'integer'}, id:{...string(64),pattern:'^[a-z0-9][a-z0-9-]*$'}, name:string(80), description:{type:'string',maxLength:1000}, author:{type:'string',maxLength:300}, license:{type:'string',maxLength:1000},
    canvas:object({width:integer(32,4096),height:integer(32,4096)},['width','height']),
    hitBox:object({x:number(0,1),y:number(0,1),width:number(.001,1),height:number(.001,1)},['x','y','width','height']), poster:string(240),
    clips:{type:'object',minProperties:1,maxProperties:64,additionalProperties:object({file:string(240),fallback:string(240),durationMs:integer(100,60000),sprite},['file','durationMs'])},
    actions:{type:'object',required:['idle'],maxProperties:32,additionalProperties:{type:'array',items:string(40),minItems:1,maxItems:32}},
    phrases:object({greeting:{type:'string',maxLength:300},tap:{type:'array',items:string(),maxItems:20},idle:{type:'array',items:string(),maxItems:20}}),
  },['version','id','name','canvas','poster','clips','actions']),
}
const path = {...string(4096),description:'Absolute local file path. For a package, select pet.json or its containing folder.'}
const tools = []
function tool(name, operation, description, inputSchema = object({}), readOnlyHint = false) {
  tools.push({ name, operation, description, inputSchema, annotations:{readOnlyHint,destructiveHint:false,openWorldHint:false} })
}
tool('pet_get_schema','schema','Get the pet package JSON Schema, parameters and a minimal manifest. No app connection or image generation is needed.',object({}),true)
tool('pet_prepare_generation','generation','Prepare a generation brief and exact asset requirements for your own image/video tool. This tool does not generate image pixels or call an AI provider.',object({description:string(1000),mode:{type:'string',enum:['image','sprite','clips']}},['description']),true)
tool('pet_list','list','List installed pets and saved settings. MarkFlow must be running with AI control enabled.',object({}),true)
tool('pet_get_state','current','Read the active pet, supported actions, settings and the latest queued command. Does not read notes or todos.',object({}),true)
tool('pet_validate_pack','validate','Validate pet.json and all referenced media, dimensions and paths without installing.',object({path},['path']),true)
tool('pet_install_pack','install','Install a validated local pet package. Existing IDs are never overwritten. Then use pet_configure to activate it.',object({path},['path']))
tool('pet_create_from_image','from_image','Create and install a pet from a local PNG/WebP/GIF/JPG image or PNG/WebP sprite sheet. A static first-frame poster is generated. Then activate with pet_configure.',object({path,name:string(80),id:string(64),sprite},['path','name']))
tool('pet_configure','configure','Apply a partial settings update to a pet and optionally activate it. Speed controls video and sprite playback; GIF/WebP animations retain their authored speed.',object({id:string(64),settings,activate:{type:'boolean',default:true}},['id']))
tool('pet_show','show','Enable the desktop pet and show it without hiding the editor or opening notes.')
tool('pet_say','perform','Queue a plain-text speech bubble with an optional action. Todo reminders take priority; queued speech expires after 30 seconds.',object({text:string(),action:string(40)},['text']))
tool('pet_play','perform','Queue an action supported by the active pet. Query pet_get_state first. Todo reminders take priority.',object({action:string(40)},['action']))
const template = { version:1,id:'my-pet',name:'我的宠物',canvas:{width:512,height:512},hitBox:{x:.1,y:.05,width:.8,height:.9},poster:'poster.png',clips:{idle:{file:'idle.webp',durationMs:3000}},actions:{idle:['idle']},phrases:{greeting:'你好，我来陪你工作。',tap:['我在呢。']} }
await mkdir('public/pet-api',{recursive:true})
await writeFile('public/pet-api/schema.json',JSON.stringify(schema,null,2)+'\n')
await writeFile('public/pet-api/protocol.json',JSON.stringify({tools,settingsSchema:settings,template},null,2)+'\n')

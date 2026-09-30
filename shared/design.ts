import { z } from 'zod';

export const designStyles = [
  {id:'minimalism',name:'Minimalism',description:'Quiet spacing, restrained color, crisp typography.',colors:['#fafaf8','#deded8','#262724']},
  {id:'glassmorphism',name:'Glassmorphism',description:'Translucent surfaces, soft blur, readable contrast.',colors:['#c5d8ef','#d6c5ef','#fafaff']},
  {id:'bento',name:'Bento',description:'Modular grids, clear hierarchy, varied tile sizes.',colors:['#d6efb0','#1d2220','#f2f0e9']},
  {id:'editorial',name:'Editorial',description:'Expressive type, generous margins, strong imagery.',colors:['#e8dfcf','#3f382e','#bc492e']},
  {id:'brutalism',name:'Neo-brutalism',description:'Bold borders, offset shadows, confident color.',colors:['#ffd842','#ff7d9d','#252525']},
  {id:'neumorphism',name:'Neumorphism',description:'Soft inset surfaces with accessible control states.',colors:['#e0e5ec','#b8bec6','#ffffff']},
  {id:'dark',name:'Dark studio',description:'Graphite surfaces, fine borders, focused highlights.',colors:['#17191c','#32353b','#b9ea87']},
  {id:'playful',name:'Playful',description:'Warm colors, friendly shapes, lively illustration.',colors:['#ffac74','#8d7de8','#fff5e6']},
] as const;

export const designEffects = [
  {id:'liquid-logo',name:'Liquid logos',description:'Liquid-metal treatment for your brand mark.',url:'https://github.com/paper-design/liquid-logo',license:'PolyForm Shield 1.0.0',guidance:'Use paper-design/liquid-logo as the integration reference. Its PolyForm Shield noncompete terms are not MIT: inspect applicability before copying and retain notices. Do not assume it is an npm package. Keep a static logo fallback.'},
  {id:'three',name:'3D models & animations',description:'Interactive scenes with React Three Fiber.',url:'https://github.com/pmndrs/react-three-fiber',license:'MIT',guidance:'Use @react-three/fiber with three in React projects; verify React compatibility. Lazy-load Canvas, dispose resources, provide a static/WebGL fallback, and avoid blocking content behind a scene.'},
  {id:'liquid-glass',name:'Liquid glass buttons',description:'Apple-inspired refractive glass controls.',url:'https://github.com/dashersw/liquid-glass-js',license:'MIT',guidance:'Use dashersw/liquid-glass-js following its actual installation instructions. Apply it to semantic buttons with keyboard focus and a CSS fallback. Check browser support and preserve readable contrast.'},
  {id:'shader-gradient',name:'Animated gradient shader',description:'Flowing wallpaper-style gradients.',url:'https://github.com/ruucm/shadergradient',license:'Check package terms',guidance:'Use @shadergradient/react following ruucm/shadergradient documentation; check package license and peer dependencies. Add a static CSS gradient fallback and pause unnecessary offscreen rendering.'},
  {id:'motion',name:'Motion transitions',description:'Spring animations and subtle layout transitions.',url:'https://github.com/motiondivision/motion',license:'MIT',guidance:'Use Motion (motion/react for React) for intentional transitions and layout animation. Respect reduced motion; do not animate every element.'},
  {id:'smooth-scroll',name:'Smooth scrolling',description:'Optional Lenis scrolling for editorial pages.',url:'https://github.com/darkroomengineering/lenis',license:'MIT',guidance:'Use lenis only where smooth scrolling helps. Preserve keyboard, anchors and native touch behavior; disable smoothing for reduced motion and clean up animation frames.'},
  {id:'particles',name:'Particles & confetti',description:'Lightweight ambient particles or celebration effects.',url:'https://github.com/tsparticles/tsparticles',license:'MIT',guidance:'Use tsParticles with the smallest suitable engine/preset. Keep particle counts low, pause hidden canvases, and provide a reduced-motion fallback.'},
] as const;

export const designSchema=z.object({
  enabled:z.boolean().default(false),
  style:z.enum(['minimalism','glassmorphism','bento','editorial','brutalism','neumorphism','dark','playful']).default('minimalism'),
  effects:z.array(z.enum(['liquid-logo','three','liquid-glass','shader-gradient','motion','smooth-scroll','particles'])).max(7).default([]),
  notes:z.string().max(2000).default(''),
});
export type DesignSettings=z.infer<typeof designSchema>;

export function designBrief(settings:DesignSettings):string {
  if(!settings.enabled)return '';
  const style=designStyles.find(s=>s.id===settings.style)!;
  const selected=designEffects.filter(e=>settings.effects.includes(e.id));
  return `\nUser's saved web-design brief (apply only to requested web/UI work):\nStyle: ${style.name}. ${style.description}\n${selected.length?'Selected libraries:\n'+selected.map(e=>`- ${e.name}: ${e.url}\n  ${e.guidance}`).join('\n'):'No optional effect libraries selected; do not add them.'}\n${settings.notes?'User design notes: '+settings.notes+'\n':''}Inspect the project stack before installing anything; use its package manager and existing components. Do not silently swap a selected library. Explain incompatibilities. Verify current upstream instructions and license terms before integration, keep notices, and install only selected dependencies as needed in the target project. Preserve accessibility, keyboard focus, contrast, mobile layouts and prefers-reduced-motion. Run the dev server with approved tools and report its actual URL for the side preview. Test the result; do not claim an effect is implemented merely because it was selected.\n`;
}

export const previewActionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('navigate'),url:z.string().url().max(2000),width:z.number().int().min(320).max(1920),height:z.number().int().min(480).max(1200)}),
  z.object({action:z.literal('refresh')}),
  z.object({action:z.literal('click'),x:z.number().min(0).max(1920),y:z.number().min(0).max(1200)}),
  z.object({action:z.literal('type'),text:z.string().max(2000)}),
  z.object({action:z.literal('key'),key:z.enum(['Enter','Tab','Shift+Tab','Backspace','Delete','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','ControlOrMeta+A'])}),
  z.object({action:z.literal('scroll'),delta:z.number().min(-2000).max(2000)}),
]);
export type PreviewAction=z.infer<typeof previewActionSchema>;
export interface PreviewFrame {image:string;url:string;title:string;width:number;height:number;errors:string[]}

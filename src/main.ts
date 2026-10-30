import { Application } from 'pixi.js';

async function start(): Promise<void> {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('#stage element missing');

  const app = new Application();
  await app.init({ resizeTo: window, background: '#141b24', antialias: true });
  stage.appendChild(app.canvas);
}

void start();

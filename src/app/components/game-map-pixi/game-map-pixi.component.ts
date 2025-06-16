import {
  Component,
  computed,
  effect,
  ElementRef,
  signal,
  inject,
  OnDestroy,
  OnInit,
  viewChild,
} from '@angular/core';
import { Application, Container, Texture } from 'pixi.js';
import {
  createClaimIndicatorTextures,
  createGameMapContainers,
  createNodeSprites,
  createPlayerIndicator,
  gamestate,
  generateMapGrid,
  initializePixiApp,
  isAtNode,
  loadGameMapTextures,
  setupMapDragging,
  setupResponsiveCanvas,
  showLocationMenu,
  calculateCameraBounds,
  clampCameraPosition,
  updateCameraPosition,
  windowHeight,
  windowWidth,
  type MapTileData,
} from '../../helpers';
import { WorldLocation } from '../../interfaces';
import { NodeSpriteData } from '../../interfaces/sprite';
import { LoadedTextures } from '../../interfaces/texture';
import { ContentService } from '../../services/content.service';
import { LoggerService } from '../../services/logger.service';

@Component({
  selector: 'app-game-map-pixi',
  template: `
    <div #pixiContainer class="w-full h-full"></div>
  `,
  styleUrls: ['./game-map-pixi.component.scss'],
})
export class GameMapPixiComponent implements OnInit, OnDestroy {
  pixiContainer = viewChild<ElementRef>('pixiContainer');

  private contentService = inject(ContentService);
  private loggerService = inject(LoggerService);

  private app?: Application;
  private mapContainer?: Container;
  private terrainTextures: LoadedTextures = {};
  private objectTextures: LoadedTextures = {};
  private checkTexture?: Texture;
  private xTexture?: Texture;
  private nodeSprites: Record<string, NodeSpriteData> = {};
  private playerIndicatorContainer?: Container;
  private resizeObserver?: ResizeObserver;

  private zoomLevel = signal(1.0);
  private readonly minZoom = 0.5;
  private readonly maxZoom = 1.0; // 1.0 = 64x64 tiles

  public nodeWidth = computed(() =>
    Math.min(
      gamestate().world.width,
      Math.floor(windowWidth() / (64 * this.zoomLevel())) + 1,
    ),
  );
  public nodeHeight = computed(() =>
    Math.min(
      gamestate().world.height,
      Math.floor(windowHeight() / (64 * this.zoomLevel())) + 1,
    ),
  );
  public camera = computed(() => gamestate().camera);
  public map = computed(() => {
    const camera = this.camera();
    const width = this.nodeWidth();
    const height = this.nodeHeight();
    const world = gamestate().world;

    return generateMapGrid(
      camera.x,
      camera.y,
      width,
      height,
      world.width,
      world.height,
    );
  });

  constructor() {
    effect(() => {
      const mapData = this.map();
      if (this.app && this.mapContainer) {
        this.updateMap(mapData.tiles);
      }
    });
  }

  async ngOnInit() {
    await this.initPixi();
    await this.loadTextures();
    this.updateMap(this.map().tiles);
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    this.app?.destroy(true);
  }

  private async initPixi() {
    this.app = await initializePixiApp(this.pixiContainer()?.nativeElement, {
      width: this.pixiContainer()?.nativeElement.clientWidth,
      height: this.pixiContainer()?.nativeElement.clientHeight,
      backgroundAlpha: 0,
      antialias: false,
    });

    const containers = createGameMapContainers(this.app);
    this.mapContainer = containers.mapContainer;
    this.playerIndicatorContainer = containers.playerIndicatorContainer;
    this.mapContainer.cullable = true;

    this.resizeObserver = setupResponsiveCanvas(
      this.app,
      this.pixiContainer()?.nativeElement,
    );

    this.setupMouseDragging();
  }

  private setupMouseDragging() {
    if (!this.app || !this.mapContainer || !this.playerIndicatorContainer)
      return;

    setupMapDragging({
      app: this.app,
      containers: [this.mapContainer, this.playerIndicatorContainer],
      viewportWidth: () => this.nodeWidth(),
      viewportHeight: () => this.nodeHeight(),
      tileSize: () => 64 * this.zoomLevel(),
    });

    // Add mouse wheel zoom
    const canvas = this.app.view as HTMLCanvasElement;
    canvas.addEventListener('wheel', (event) => this.onWheel(event));
  }

  // Zooming now adjusts the camera instead of repositioning the PIXI containers.

  private onWheel(event: WheelEvent) {
    if (!this.mapContainer || !this.app) return;
    event.preventDefault();

    // Calculate new zoom level
    const oldZoom = this.zoomLevel();
    const zoomDelta = event.deltaY < 0 ? 0.1 : -0.1;
    let newZoom = this.zoomLevel() + zoomDelta;
    newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));
    if (newZoom === oldZoom) return;
    this.zoomLevel.set(newZoom);

    // Get mouse position relative to the map container
    const rect = (this.app.view as HTMLCanvasElement).getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Calculate world position under cursor before zoom
    const mapPos = this.mapContainer.position;
    const worldX = (mouseX - mapPos.x) / oldZoom;
    const worldY = (mouseY - mapPos.y) / oldZoom;

    // Apply new zoom
    this.mapContainer.scale.set(this.zoomLevel());
    this.playerIndicatorContainer?.scale.set(this.zoomLevel());

    // Determine which world tile should remain under the mouse cursor
    const worldTileX = worldX / 64 + this.camera().x;
    const worldTileY = worldY / 64 + this.camera().y;

    const newCameraX = worldTileX - mouseX / (64 * this.zoomLevel());
    const newCameraY = worldTileY - mouseY / (64 * this.zoomLevel());

    const bounds = calculateCameraBounds(
      gamestate().world.width,
      gamestate().world.height,
      Math.min(
        gamestate().world.width,
        Math.floor(windowWidth() / (64 * this.zoomLevel())) + 1,
      ),
      Math.min(
        gamestate().world.height,
        Math.floor(windowHeight() / (64 * this.zoomLevel())) + 1,
      ),
    );

    const clamped = clampCameraPosition({ x: newCameraX, y: newCameraY }, bounds);
    updateCameraPosition({
      x: Math.floor(clamped.x),
      y: Math.floor(clamped.y),
    });
  }

  private async loadTextures() {
    try {
      const artAtlases = this.contentService.artAtlases();
      const textures = await loadGameMapTextures(
        artAtlases['world-terrain'],
        artAtlases['world-object'],
      );
      this.terrainTextures = textures.terrainTextures;
      this.objectTextures = textures.objectTextures;

      const claimTextures = createClaimIndicatorTextures();
      this.checkTexture = claimTextures.checkTexture;
      this.xTexture = claimTextures.xTexture;
    } catch (error) {
      this.loggerService.error('Failed to load textures:', error);
    }
  }

  private updateMap(mapData: MapTileData[][]) {
    if (!this.mapContainer || !this.playerIndicatorContainer) return;

    this.mapContainer.removeChildren();
    this.playerIndicatorContainer.removeChildren();
    this.nodeSprites = {};

    mapData.forEach((row) => {
      row.forEach(({ x, y, nodeData }) => {
        this.createNodeSprites(x, y, nodeData);
      });
    });

    this.updatePlayerIndicators(mapData);
  }

  private createNodeSprites(x: number, y: number, nodeData: WorldLocation) {
    if (!this.mapContainer) return;

    const nodeKey = `${x}-${y}`;
    const spriteData = createNodeSprites(
      x,
      y,
      nodeData,
      this.terrainTextures,
      this.objectTextures,
      this.mapContainer,
      this.checkTexture,
      this.xTexture,
      (nodeData: WorldLocation) => this.investigateLocation(nodeData),
    );

    if (spriteData) {
      this.nodeSprites[nodeKey] = spriteData;
    }
  }

  private updatePlayerIndicators(mapData: MapTileData[][]) {
    if (!this.playerIndicatorContainer || !this.app) return;

    mapData.forEach((row) => {
      row.forEach(({ x, y, nodeData }) => {
        if (!isAtNode(nodeData)) return;

        createPlayerIndicator(
          x,
          y,
          this.playerIndicatorContainer!,
          this.app!.ticker,
        );
      });
    });
  }

  private investigateLocation(nodeData: WorldLocation) {
    showLocationMenu.set(nodeData);
  }
}

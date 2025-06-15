export interface CameraState {
  x: number;
  y: number;
}

export interface DragState {
  isDragging: boolean;
  lastPointerPosition: { x: number; y: number };
  accumulatedDrag: { x: number; y: number };
}

export interface CameraBounds {
  maxX: number;
  maxY: number;
}

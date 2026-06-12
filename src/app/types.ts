// Shared data-model types for pretix / TipTip seating JSONs.
// Files may carry extra fields (uuid, zone_id, …) — they survive untouched
// because we only ever mutate known fields on parsed JSON.

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rectangle {
  width: number;
  height: number;
}

export interface TextContent {
  text: string;
  color: string;
  size: number;
  position?: Position;
}

export interface Radius {
  x: number;
  y: number;
}

export interface Ellipse {
  radius: Radius;
}

export interface Circle {
  radius: number;
}

export interface Polygon {
  points: Position[];
}

export interface Area {
  uuid?: string;
  shape: string;
  position: Position;
  color: string;
  border_color: string;
  rectangle?: Rectangle;
  text?: TextContent;
  rotation?: number;
  ellipse?: Ellipse;
  circle?: Circle;
  polygon?: Polygon;
}

export interface Seat {
  uuid?: string;
  seat_guid: string;
  seat_number: string;
  position: Position;
  category: string;
  status?: string;
  radius?: number;
}

// row_number_position: where pretix renders the row label ('start' | 'end' | 'both')
// seat_label: pretix label template, e.g. "AA%s"
export interface Row {
  uuid?: string;
  position: Position;
  seats: Seat[];
  row_number?: string;
  row_number_position?: string;
  seat_label?: string;
}

export interface Zone {
  uuid?: string;
  zone_id?: string;
  name?: string;
  position: Position;
  rows: Row[];
  areas?: Area[];
}

// `name` is what TipTip consumes — the ticket UUID of the target show.
// `label` is our human-readable alias; TipTip's importer tolerates the extra
// field (verified June 2026), so it travels inside the JSON and survives the
// per-show UUID swap.
export interface Category {
  name: string;
  color: string;
  label?: string;
}

export interface SeatData {
  name: string;
  size: Size;
  zones: Zone[];
  categories: Category[];
}

export type SelectedObject = {
  type: 'seat' | 'area' | 'row';
  id: string;
  data: Seat | Area | Row;
  zoneIndex: number;
  rowIndex?: number;
  seatIndex?: number;
  areaIndex?: number;
};

export interface ViewState {
  scale: number;
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

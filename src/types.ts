export type OperacionTipo = 'ALQUILAR' | 'VENDER' | '';

export interface ClientData {
  nombre?: string;
  apellido?: string;
  email?: string;
  telefono?: string;
  link?: string;
  tipoOperacion?: OperacionTipo;
  propiedadInfo?: string;
  propertyAddress?: string;
  mascotas?: string;
  requisitos?: string;
  [key: string]: any;
}

// Meta information
export interface Meta {
  limit: number;
  next: string | null;
  offset: number;
  previous: string | null;
  total_count: number;
}

// Branch information
export interface Branch {
  address: string;
  alternative_phone: string;
  alternative_phone_area: string;
  alternative_phone_country_code: string;
  alternative_phone_extension: string;
  branch_type: string;
  contact_time: string;
  created_date: string;
  display_name: string;
  email: string;
  geo_lat: string;
  geo_long: string;
  gm_location_type: string;
  id: number;
  is_default: boolean;
  logo: string;
  name: string;
  pdf_footer_text: string;
  phone: string;
  phone_area: string;
  phone_country_code: string;
  phone_extension: string;
  use_pdf_footer: boolean;
}

// Location division
export interface LocationDivision {
  // Puedes definir propiedades específicas si las conoces
}

// Location information
export interface Location {
  divisions: LocationDivision[];
  full_location: string;
  id: number;
  name: string;
  parent_division: string;
  short_location: string;
  state: string | null;
  weight: number;
  zip_code: string | null;
}

// Occupation information
export interface Occupation {
  // Puedes definir propiedades específicas si las conoces
}

// Price information
export interface Price {
  currency: string;
  is_promotional: boolean;
  period: number;
  price: number;
}

// Operation information
export interface Operation {
  operation_id: number;
  operation_type: string;
  prices: Price[];
}

// Extra attributes
export interface ExtraAttribute {
  is_expenditure: boolean;
  is_measure: boolean;
  name: string;
  value: string;
}

// Photo information
export interface Photo {
  description: string | null;
  image: string;
  is_blueprint: boolean;
  is_front_cover: boolean;
  order: number;
  original: string;
  thumb: string;
}

// Producer information
export interface Producer {
  cellphone: string;
  email: string;
  id: number;
  name: string;
  phone: string;
  picture: string;
  position: string;
}

// Property type
export interface PropertyType {
  code: string;
  id: number;
  name: string;
}

// Video information
export interface Video {
  // Puedes definir propiedades específicas si las conoces
}

// Main property object
export interface Property {
  address: string;
  address_complement: string;
  age: number;
  apartment_door: string;
  appartments_per_floor: number;
  bathroom_amount: number;
  block_number: string;
  branch: Branch;
  building: string;
  cleaning_tax: string;
  common_area: string;
  covered_parking_lot: number;
  created_at: string;
  credit_eligible: string;
  custom1: string;
  custom_tags: any[];
  deleted_at: string;
  depth_measure: string;
  description: string;
  description_only: string;
  development: string | null;
  development_excel_extra_data: string;
  dining_room: number;
  disposition: string | null;
  down_payment: string;
  expenses: number;
  extra_attributes: ExtraAttribute[];
  fake_address: string;
  files: any[];
  fire_insurance_cost: string;
  floor: string;
  floors_amount: number;
  footer: string;
  front_measure: string;
  geo_lat: string;
  geo_long: string;
  gm_location_type: string;
  guests_amount: number;
  has_temporary_rent: boolean;
  id: number;
  iptu: string;
  is_denounced: boolean;
  is_starred_on_web: boolean;
  legally_checked: string;
  livable_area: string;
  living_amount: number;
  location: Location;
  location_level: string | null;
  lot_number: string;
  occupation: Occupation[];
  operations: Operation[];
  orientation: string | null;
  parking_lot_amount: number;
  parking_lot_condition: string | null;
  parking_lot_type: string | null;
  photos: Photo[];
  private_area: string;
  producer: Producer;
  property_condition: string;
  public_url: string;
  publication_title: string;
  quality_level: string | null;
  real_address: string;
  reference_code: string;
  rich_description: string;
  roofed_surface: string;
  room_amount: number;
  semiroofed_surface: string;
  seo_description: string;
  seo_keywords: string;
  situation: string;
  status: number;
  suite_amount: number;
  suites_with_closets: number;
  surface: string;
  surface_measurement: string;
  tags: any[];
  toilet_amount: number;
  total_suites: number;
  total_surface: string;
  transaction_requirements: string;
  tv_rooms: number;
  type: PropertyType;
  uncovered_parking_lot: number;
  unroofed_surface: string;
  videos: Video[];
  web_price: boolean;
  zonification: string;
}

// Main response object
export interface PropertyResponse {
  meta: Meta;
  objects: Property[];
}
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
  [key: string]: any;
}
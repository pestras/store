import { filter } from "rxjs/operators";

export function filterNil<T>() {
  return filter<T>(val => val !== undefined && val !== null);
}
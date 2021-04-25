import { Observable } from "rxjs";
import { hasChanges } from '@pestras/toolbox/object/has-changes';

export function distinctUntilObjChanged<T>(keys?: string[]) {
  let prev: T = null;
  return function (source: Observable<T>) {
    return new Observable<T>(subscriber => {
      return source.subscribe({
        next(curr) { setTimeout(() => {
          if (hasChanges(prev, curr, <string[]>keys)) {
            prev = typeof curr === "object" && curr !== null ? {...curr} : null;
            subscriber.next(curr); 
          }
        }); }, // ? {...curr} : curr
        error(err) { subscriber.error(err) },
        complete() { subscriber.complete() }
      })
    });
  }
}
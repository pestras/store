import { Observable } from "rxjs";
import { arrayHasChanges } from '@pestras/toolbox/array/array-has-changes';

export function distinctUntilArrChanged<T>(index?: keyof T, keys?: string[]) {
  let prev: T[];
  return function (source: Observable<T[]>) {
    return new Observable<T[]>(subscriber => {
      return source.subscribe({
        next(curr) {
          setTimeout(() => { if (arrayHasChanges(prev, curr, <string>index, <string[]>keys)) subscriber.next(prev = curr); });
        },
        error(err) { subscriber.error(err) },
        complete() { subscriber.complete() }
      })
    });
  }
}
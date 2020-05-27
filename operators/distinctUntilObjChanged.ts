import { Observable } from "rxjs";
import { hasChanges } from '@pestras/toolbox/object/has-changes';

export function distinctUntilObjChanged<T>(keys?: string[]) {
  let prev: T;
  return function (source: Observable<T>) {
    return new Observable<T>(subscriber => {
      return source.subscribe({
        next(curr) { setTimeout(() => { if (hasChanges(prev, curr, <string[]>keys)) subscriber.next(prev = curr); }); },
        error(err) { subscriber.error(err) },
        complete() { subscriber.complete() }
      })
    });
  }
}
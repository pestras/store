import { Observable, BehaviorSubject, combineLatest } from "rxjs";
import { filter, map } from "rxjs/operators";

export function gate<T>(guard: Observable<boolean>, invert = false) {

  return function (source: Observable<T>) {
    return combineLatest(source, guard)
      .pipe(
        filter(([, open]) => invert ? !open : open),
        map(([value]) => value)
      )
  }
} 
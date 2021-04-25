import { Observable } from "rxjs";
import { filter, map, switchMap, distinctUntilChanged } from "rxjs/operators";

export function gate<T>(controller: Observable<boolean>, inverse = false) {
  return function(source: Observable<T>) {
    return source.pipe(
      switchMap(
        val => controller.pipe(
          filter(open => (inverse ? !open : open)),
          distinctUntilChanged(),
          map(() => val)
        )
      )
    );
  };
}
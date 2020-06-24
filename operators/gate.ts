import { Observable } from "rxjs";
import { filter, map, switchMap, distinctUntilChanged } from "rxjs/operators";

export function gate<T>(controller: Observable<boolean>, invert = false) {
  return function(source: Observable<T>) {
    return source.pipe(
      switchMap(
        val => controller.pipe(
          filter(open => (invert ? !open : open)),
          distinctUntilChanged(),
          map(() => val)
        )
      )
    );
  };
}
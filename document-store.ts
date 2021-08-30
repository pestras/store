import { BehaviorSubject, combineLatest, Observable } from "rxjs";
import { map, shareReplay, distinctUntilChanged, filter } from 'rxjs/operators';
import { distinctUntilObjChanged } from "./operators/distinctUntilObjChanged";
import { getValue } from '@pestras/toolbox/object/get-value';
import { omit } from '@pestras/toolbox/object/omit';

/**
 * Document Store manage the state of an object, providing crud apis
 * and change emitters 
 */
export abstract class DocumentStore<T = any> {

  // Private Members
  // ----------------------------------------------------------------------------------------------
  /** Idle state behavior subject */
  private _idleSub = new BehaviorSubject<boolean>(false);
  /** data behavior subject */
  private _dataSub = new BehaviorSubject<T>(null);

  // Protected Members
  // ----------------------------------------------------------------------------------------------
  /** Idle state setter */
  protected set idle(val: boolean) {
    this._idleSub.next(val);
  }

  /**
   * Creates a clone of an input document
   * @param doc **T** : *input document data*
   * @returns **T**
   */
  protected map(doc: T): T {
    return !!doc ? Object.assign({}, doc) : null;
  }

  /**
   * Update document
   * @param data **Partial\<T\>** : *update*
   * @param replace **boolean?** : *replace document or default merge*
   * @returns **T**
   */
  protected update(data: Partial<T>, replace = false, emit = true): T {
    if (!data)
      return null;

    let curr = this.get();

    if (curr && !replace)
      Object.assign(curr, data);
    else
      curr = this.map(<T>data);

    this._dataSub.next(curr);
    return curr;
  }

  /**
   * Remove list of dields from the document
   * @param keyPaths **Array\<keyof T\>** : *Array of fields path*
   * @returns **T**
   */
  protected remove<U extends keyof T>(keyPaths: U[], emit = true): T {
    let data = this.get();

    if (!data)
      return null;

    omit(data, <string[]>keyPaths);

    this._dataSub.next(data);
    return data;
  }

  /** Clear document data then emit **null** value */
  protected clear(emit = true): void {
    if (this._dataSub.getValue() === null)
      return;

    this._dataSub.next(null);
  }

  // Public Members
  // ----------------------------------------------------------------------------------------------
  /** Idle state emitter */
  public readonly idle$ = this._idleSub.pipe(distinctUntilChanged(), shareReplay(1));

  /** Idle state getter */
  public get isIdle() {
    return this._idleSub.getValue();
  }

  /** 
   * Get document current state clone 
   * @returns **T**
   */
  public get(): T;
  /**
   * Get document specific field value
   * @param keyPath **keyof T** : *key name*
   * @returns **T[U]** : *Specific field value*
   */
  public get<U extends keyof T>(keyPath: U): T[U];
  public get<U extends keyof T>(keyPath?: U) {
    let data = this._dataSub.getValue();
    return keyPath
      ? getValue(data, <string>keyPath)
      : this.map(data);
  }

  /**
   * Watch document for changes
   * @returns **Observable\<T\>**
   */
  public get$(): Observable<T>;
  /**
   * Watch document when any value of provided keys paths change. 
   * @param keyPaths **keyof T** : *array of fields paths to watch change*
   * @returns **Observalbe\<T\>**
   */
  public get$<U extends keyof T>(keyPaths: U[]): Observable<T>;
  public get$<U extends keyof T>(keyPaths?: U[]): Observable<T> {
    return combineLatest([this._idleSub, this._dataSub])
      .pipe(
        filter(([idle]) => !!idle),
        map(([, doc]) => this.map(doc)),
        distinctUntilObjChanged(<string[]>keyPaths),
        shareReplay(1)
      );
  }
}
import { BehaviorSubject, Observable, combineLatest } from "rxjs";
import { map, shareReplay, distinctUntilChanged, filter } from "rxjs/operators";
import { ActiveDocumnet } from "./active-document";
import { distinctUntilObjChanged } from "./operators/distinctUntilObjChanged";

/**
 * Map store, manages the state of map of documents providing crud
 * apis and change emitters
 */
export class MapStore<T = any> {

  // Constructor
  // ----------------------------------------------------------------------------------------------
  /**
   * Map store constructor
   * @param idPath **string?** : *defaults to 'id'*
   */
  constructor(public readonly idPath = "id") { }

  // Private Members
  // ----------------------------------------------------------------------------------------------
  /** Idle state behavior subject */
  private _idleSub = new BehaviorSubject<boolean>(false);

  /** Active document change behavior subject */
  private _activeSub = new BehaviorSubject<string>(null);

  /** data behavior subject */
  private _dataSub = new BehaviorSubject<Map<string, T>>(null);

  /** Data emitter */
  private _docs$ = combineLatest([this._idleSub, this._dataSub])
    .pipe(filter(([idle]) => idle), map(([, data]) => this.toArray(data)));

  /**
   * Get single document by id
   * @param id **string** : *document id*
   * @returns **T**
   */
  private _doc(id: string): T;
  /**
   * Get single document by filter
   * @param filter **(doc: T) => boolean** : *document filter*
   * @returns **T**
   */
  private _doc(filter: (doc: T) => boolean): T;
  private _doc(filter: string | ((doc: T) => boolean)) {
    if (typeof filter === 'function') {
      for (let doc of this.toArray(this.container))
        if (filter(doc))
          return doc;
    } else
      return this.container.get(filter);
  }

  /** 
   * Get all documents
   * @returns **T[]**
   */
  private _docs(): T[];
  /**
   * Get multiple documents by ids
   * @param ids **string[]** : *Array of documents ids*
   * @returns **T[]**
   */
  private _docs(ids: string[]): T[];
  /**
   * Get multiple documents by filter
   * @param filter **(doc: T) => boolean** : *documents filter*
   * @returns **T[]**
   */
  private _docs(filter: (doc: T) => boolean): T[];
  private _docs(filter?: string[] | ((doc: T) => boolean)) {
    let result: T[] = [];

    if (!filter) {
      return this.toArray(this.container);

    } else if (typeof filter === 'function') {
      for (let doc of this.toArray(this.container))
        if (filter(doc))
          result.push(doc);

    } else
      for (let id of filter) {
        let doc = this.container.get(id);
        !!doc && result.push(doc);
      }

    return result;
  }

  // Protected Members
  // ----------------------------------------------------------------------------------------------
  protected onChange?(data: T[], type: 'insert' | 'update' | 'replace' | 'remove' | 'clear'): void;

  /**
   * Creates a clone of an input document
   * @param doc **T** : *input document data*
   * @returns **T**
   */
  protected map(doc: T): T {
    return !!doc ? Object.assign({}, doc) : null;
  };

  /** 
   * Current map state getter
   * @returns **Map\<string, T\>**
   */
  protected get container() {
    return this._dataSub.getValue() || new Map<string, T>();
  }

  /** Idle state setter */
  protected set idle(val: boolean) {
    this._idleSub.next(val);
  }

  /**
   * Convert data map to an array
   * @param data **Map\<string, T\>** : *Documents Map* 
   * @returns **T[]**
   */
  protected toArray(data: Map<string, T>) {
    return Array.from(data.values());
  }

  /**
   * Convert documents array to Map
   * @param docs **T[]** : *Array of documents*
   * @returns **Map\<string, T\>**
   */
  protected docsToMap(docs: T[]) {
    let container = new Map<string, T>();
    for (let doc of docs) container.set(doc[this.idPath], doc);
    return container;
  }

  /**
   * Set new active document
   * @param id **string** : *document id*
   */
  protected setActive(id: string): void {
    this._activeSub.next(id);
  }

  /**
   * Insert new document, with the ability to replace old document
   * @param doc **T** : *new document*
   * @param replace **boolean?** : *replace old document*
   * @returns **T**
   */
  protected insert(doc: T, replace = false): T {
    let container = this.container;

    if (container.has(doc[this.idPath]) && !replace)
      return null;

    container.set(doc[this.idPath], doc);

    this.onChange && this.onChange([doc], 'insert');
    this._dataSub.next(container);
    return doc;
  }

  /**
   * Insert multiple documents, with the ability to replace old ones
   * @param docs **T[]** : *Array of new documents*
   * @param replace **boolean?** : *replace old documents*
   * @returns **T[]**
   */
  protected insertMany(docs: T[], replace = false): T[] {
    let map = this.container;
    let inserted: T[] = [];

    for (let doc of docs) {
      if (map.has(doc[this.idPath]) && !replace)
        continue;

      map.set(doc[this.idPath], doc);
      inserted.push(doc);
    };

    if (inserted.length === 0)
      return [];

    this.onChange && this.onChange(inserted, 'insert');
    this._dataSub.next(map);
    return inserted;
  }

  /**
   * Update document by id
   * @param id **string** : *Document id*
   * @param update **Partial\<T\>** : *update*
   * @returns **T**
   */
  protected update(id: string, update: Partial<T>): T {
    let map = this.container;

    if (!map.has(id))
      return null;

    let doc = map.get(id);
    Object.assign(doc, update);
    map.set(id, doc);

    this.onChange && this.onChange([doc], 'update');
    this._dataSub.next(map);
    return doc;
  }

  /**
   * Update multiple documents by ids
   * @param ids **string[]** : *documents ids*
   * @param update **Partial\<T\>** : *update*
   * @returns **T[]**
   */
  protected updateMany(ids: string[], update: Partial<T>): T[];
  /**
   * Update multiple documents by filter
   * @param filter **(doc: T) => boolean** : *Document filter*
   * @param update **Partial\<T\>** : *update*
   * @returns **T[]**
   */
  protected updateMany(filter: (doc: T) => boolean, update: Partial<T>): T[];
  protected updateMany(filter: string[] | ((doc: T) => boolean), update: Partial<T>): T[] {
    let map = this.container;
    let updated: T[] = [];

    if (typeof filter === "function") {
      for (let doc of this.docs()) {

        if (!filter(doc))
          continue;

        Object.assign(doc, update);
        map.set(doc[this.idPath], doc);
        updated.push(doc);
      }
    } else {
      for (let id of filter) {
        let doc = map.get(id);

        if (!doc)
          continue;

        Object.assign(doc, update);
        map.set(doc[this.idPath], doc);
        updated.push(doc);
      }
    }

    if (updated.length === 0)
      return [];

    this.onChange && this.onChange(updated, 'update');
    this._dataSub.next(map);

    return updated;
  }

  /**
   * Update multiple documents with individual updates,
   * each update must include the document id.
   * @param updates **Partial\<T\>[]** : *Updates*
   * @returns **T[]**
   */
  protected bulkUpdate(updates: Partial<T>[]): T[] {
    let map = this.container;
    let updated: T[] = [];

    for (let update of updates) {
      let id = update[this.idPath];

      if (!id)
        continue;

      let doc = map.get(id);

      if (!doc)
        continue;

      Object.assign(doc, update);
      map.set(id, doc);
      updated.push(doc);
    }

    if (updated.length === 0)
      return [];

    this.onChange && this.onChange(updated, 'update');
    this._dataSub.next(map);

    return updated;
  }

  /**
   * Clear store then add the new documents. 
   * @param docs **T[]** : *Array of documents*
   * @returns **T[]**
   */
  protected replaceAll(docs: T[]): T[] {
    let map = this.docsToMap(docs);

    this.onChange && this.onChange(docs, 'replace');
    this._dataSub.next(map);
    return docs;
  }

  /**
   * Remove single document
   * @param id **string** : *Document id*
   * @returns **T**
   */
  protected removeOne(id: string): T {
    let map = this.container;
    let doc = map.get(id);

    if (!doc)
      return null;

    map.delete(id);
    this.onChange && this.onChange([doc], 'remove');
    this._dataSub.next(map);

    return doc;
  }

  /**
   * Remove multiple documents by ids
   * @param ids **string[]** : *Array of documents ids**
   * @returns **T[]**
   */
  protected removeMany(ids: string[]): T[]
  /**
   * Remove multiple documents by filter
   * @param filter **(doc: T) => boolean** : *Documents filter**
   * @returns **T[]**
   */
  protected removeMany(filter: (doc: T) => boolean): T[]
  protected removeMany(filter: string[] | ((doc: T) => boolean)): T[] {
    let map = this.container;
    let removed: T[] = [];

    if (typeof filter === "function") {
      for (let doc of this.docs()) {
        if (!filter(doc))
          continue;

        this.container.delete(doc[this.idPath]);
        removed.push(doc);
      }
    } else {
      for (let id of filter) {
        let doc = map.get(id);

        if (!doc)
          continue;

        this.container.delete(id);
        removed.push(doc);
      }
    }

    if (removed.length === 0)
      return [];

    this.onChange && this.onChange(removed, 'remove');
    this._dataSub.next(map);

    return removed;
  }

  /** Clear all documents */
  protected clear(): void {
    this.onChange && this.onChange([], 'clear');
    this._dataSub.next(new Map<string, T>());
  }

  // Public Members
  // ----------------------------------------------------------------------------------------------
  /** Idle state emitter */
  public readonly idle$ = this._idleSub
    .pipe(distinctUntilChanged(), shareReplay(1));

  /** Active document initializer */
  public readonly active = new ActiveDocumnet<T>(this.map, combineLatest([this._activeSub, this._dataSub])
    .pipe(map(([id]) => this.doc(id))));

  /** 
   * Idle state getter
   * @returns **boolean**
    */
  public get isIdle() {
    return this._idleSub.getValue();
  }

  /** 
   * Current documents count getter
   * @returns **number**
   */
  public get count() {
    return this.container.size;
  }

  /** Documents count change observable */
  public readonly count$ = this._dataSub
    .pipe(map(data => data?.size || 0), distinctUntilChanged(), shareReplay(1));

  /**
   * Get single document by id
   * @param id **string** : *document id*
   * @returns **T**
   */
  public doc(id: string): T;
  /**
   * Get single document by filter
   * @param filter **(doc: T) => boolean** : *document filter*
   * @returns **T**
   */
  public doc(filter: (doc: T) => boolean): T;
  public doc(filter: string | ((doc: T) => boolean)) {
    return this._doc(<any>filter);
  }

  /**
   * Check single document exists by id
   * @param id **string** : *document id*
   * @returns **boolean**
   */
  public has(id: string): boolean;
  /**
   * Check single document exists by filter
   * @param filter **(doc: T) => boolean** : *document filter*
   * @returns **boolean**
   */
  public has(filter: (doc: T) => boolean): boolean;
  public has(filter: string | ((doc: T) => boolean)) {
    return this._doc(<any>filter) !== undefined;
  }

  /** Get all documents */
  public docs(): T[];
  /**
   * Get documents by ids
   * @param ids **string[]** : *Array of documents ids*
   * @returns **T[]**
   */
  public docs(ids: string[]): T[];
  /**
   * get documents by filter
   * @param filter **(doc: T) => boolean** : *documents filter*
   * @returns **T[]**
   */
  public docs(filter: (doc: T) => boolean): T[];
  public docs(filter?: string[] | ((doc: T) => boolean)) {
    return this._docs(<any>filter);
  }

  /**
   * Subscribe to a single document change by id
   * @param id **string** :  *document id*
   * @param keys **(keyof T)[]?** : *specific fields to watch*
   * @returns **Observable\<T\>**
   */
  public doc$(id: string, keys?: (keyof T)[]): Observable<T>;
  /**
   * Subscribe to a single document change by filter
   * @param filter **(doc: T) => boolean** : *document filter*
   * @param keys **(keyof T)[]?** *specific fields to watch*
   * @returns **Observable\<T\>**
   */
  public doc$(filter: (doc: T) => boolean, keys?: (keyof T)[]): Observable<T>;
  public doc$(filter: string | ((doc: T) => boolean), keys?: (keyof T)[]) {
    return this._docs$
      .pipe(map(() => this._doc(<any>filter)), distinctUntilObjChanged(<string[]>keys), shareReplay(1));
  }

  /**
   * Subscribe to a single document existance by id
   * @param id **string** : *document id*
   * @returns **Observable\<boolean\>**
   */
  public has$(id: string): Observable<boolean>;
  /**
   * Subscribe to a single document existance by filter
   * @param filter **(doc: T) => boolean** : *document filter*
   * @returns **Observable\<boolean\>**
   */
  public has$(filter: (doc: T) => boolean): Observable<boolean>;
  public has$(filter: string | ((doc: T) => boolean)) {
    return this._docs$.pipe(
      map(() => this._doc(<any>filter)),
      distinctUntilObjChanged(),
      map(Boolean),
      shareReplay(1)
    );
  }

  /**
   * Subscribe to multiple documents change by ids
   * @param id **string[]** : *array of documents ids*
   * @returns **Observable\<T[]\>**
   */
  public docs$(id: string[]): Observable<T[]>;
  /**
   * Subscribe to multiple documents change by filter
   * @param filter **(doc: T) => boolean** : *documents filter*
   * @returns **Observable\<T[]\>**
   */
  public docs$(filter: (doc: T) => boolean): Observable<T[]>;
  public docs$(filter?: string[] | ((doc: T) => boolean)) {
    return this._docs$.pipe(map(() => this._docs(<any>filter)), shareReplay(1));
  }
}
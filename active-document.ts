// Copyright (c) 2021 Pestras
// 
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

import { Observable } from "rxjs";
import { DocumentStore } from "./document-store";

/**
 * List store active document class
 */
 export class ActiveDocumnet<T = any> extends DocumentStore<T> {

  // Constructor
  // ----------------------------------------------------------------------------------------------
  /**
   * Active document constructor
   * @param mapper **(doc: T) => T** : *clone document function*
   * @param change$ **Observable\<Partial\<T\>\>** : *document change observable*
   */
  constructor(private mapper: (doc: T) => T, change$: Observable<Partial<T>>) {
    super();

    change$.subscribe(data => {
      if (data)
        this.update(data, true);
      else
        this.clear();
    });

    this.idle = true;
  }

  // Protected Mambers
  // ----------------------------------------------------------------------------------------------
  /**
   * Creates a clone of an input document
   * @param doc **T** : *input document data*
   * @returns **T**
   */
  protected map(doc: T): T {
    return this.mapper(doc);
  }
}
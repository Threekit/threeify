//
// basic node
//
// Authors:
// * @bhouston

import { AttributeGeometry } from "../geometry/AttributeGeometry.js";

class Mesh extends Node {

    attributeGeometry: AttributeGeometry;
 
    constructor( attributeGeometry : AttributeGeometry ) {

        super();

        this.attributeGeometry = attributeGeometry;

    }

}
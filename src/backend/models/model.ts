

/**
 * @model true 
 */
export class SomeKeyWord {
  name = ''
}


/**
 * @model true 
 */
export class SomeReturnValue {
  myValue = 100
  response = ''
  someList : string[]
  keys : SomeKeyWord[]
}


/**
 * @model true 
 */
export class CreateDevice {
  name: string
  description: string
}

/**
 * @model true 
 */
export class CreateUser {
  name: string
  address: string
  age:number
}

/**
 * @model true 
 */
export class TestUser {
  name:string
}

/**
 * @model true
 */
export class Device {
  id: number
  name: string
}

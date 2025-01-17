import * as R from "robowr";
import {
  MethodDeclaration,
  ClassDeclaration,
  Project,
  InterfaceDeclaration,
  ParameterDeclaration,
  CodeBlockWriter
} from "ts-simple-ast";
import * as utils from "../utils";
import { isBoolean } from "util";

const getTypeName = utils.getTypeName;
const isSimpleType = utils.isSimpleType;
const getTypePath = utils.getTypePath;
const getSwaggerType = utils.getSwaggerType;
const getMethodDoc = utils.getMethodDoc;

let models: { [key: string]: utils.InterfaceOrClass } = {};

export const initSwagger = (wr: R.CodeWriter, service: any): R.CodeWriter => {
  const base = {
    swagger: "2.0",
    basePath: service.endpoint || "/v1/",
    paths: {},
    definitions: {},
    schemes: ["http", "https"],
    info: {
      version: service.version,
      title: service.title || "",
      description: service.description || "",
      termsOfService: service.tos || ""
    },
    tags: []
  };
  wr.getState().swagger = base;
  models = {};
  return wr;
};

export const WriteEndpoint = (
  wr: R.CodeWriter,
  project: Project,
  clName: ClassDeclaration,
  method: MethodDeclaration,
  clientWriter?: R.CodeWriter
): R.CodeWriter => {
  const methodInfo = getMethodDoc(method);
  if (methodInfo.tags.nogenerate) return wr;

  const fc = method.getChildAtIndex(0);
  if (fc && fc.getText().indexOf("private") === 0) {
    return wr;
  }

  let methodName = method.getName();
  const methodAlias = methodInfo.tags.alias || methodName;

  const basePath = wr.getState().swagger.basePath;

  let pathParams: ParameterDeclaration[] = [];
  let queryParams: ParameterDeclaration[] = [];
  let bodyParams: ParameterDeclaration[] = [];

  const path = methodAlias.split("/"); // for example "users/documents"
  const methodParams = method.getParameters();

  // TODO: create setting for making params in the query
  // methodInfo.tags.queryparams
  for (let i = 0; i < path.length; i++) {
    if (
      methodParams[i] &&
      !(methodParams[i].getName() === methodInfo.tags.query) &&
      isSimpleType(methodParams[i].getType())
    ) {
      // only ID types here
      pathParams.push(methodParams[i]);
    } else {
      break; // no more
    }
  }

  // collect query parameters after the path parameters
  for (let i = pathParams.length; i < methodParams.length; i++) {
    if (isSimpleType(methodParams[i].getType())) {
      // only ID types here
      queryParams.push(methodParams[i]);
    } else {
      break; // no more
    }
  }

  // collect post parameters after the path parameters
  for (
    let i = pathParams.length + queryParams.length;
    i < methodParams.length;
    i++
  ) {
    bodyParams.push(methodParams[i]);
  }

  const is_post = bodyParams.length > 0;
  let httpMethod = methodInfo.tags.method || (is_post ? "post" : "get");

  const pathParamStr = pathParams
    .map(param => {
      return ":" + param.getName();
    })
    .join("/");

  const addTag = (tagname: string, description: string) => {
    const swagger = wr.getState().swagger;
    if (swagger.tags.filter(t => t.name === tagname).length === 0) {
      swagger.tags.push({ name: tagname, description });
    }
  };
  const addTagDescription = (tagname: string, description?: string) => {
    const swagger = wr.getState().swagger;
    const tag = swagger.tags.filter(t => t.name === tagname).pop();
    if (tag && description) {
      tag.description = description;
    }
  };

  // build the path for api path
  let apiPath = "";
  path.forEach((pathPart, i) => {
    apiPath += pathPart + "/";
    if (pathParams[i]) {
      apiPath += ":" + pathParams[i].getName() + "/";
    }
  });

  wr.out(`// Automatically generated endpoint for ${methodName}`, true);
  wr.out(
    `app.${httpMethod}('${basePath}${apiPath}', async function( req:TRequest, res:TResponse ) {`,
    true
  );
  wr.indent(1);

  wr.out("try {", true);
  wr.indent(1);

  // Validate the imput parametes from path

  const pathArgs = pathParams.map(param =>
    createValidatorFor(wr, "req.params." + param.getName(), param)
  );

  const queryArgs = queryParams.map(param => {
    return createValidatorFor(wr, "req.query." + param.getName(), param);
    /*
    const pname = "req.query." + param.getName();
    if (getTypeName(param.getType()) === "boolean") {
      return `typeof(${pname}) === 'undefined' ? ${pname} : ${pname} === 'true'`;
    }
    return "req.query." + param.getName();
    */
  });
  const postArgs = bodyParams.length > 0 ? ["req.body"] : [];
  const paramList = [...pathArgs, ...queryArgs, ...postArgs].join(", ");
  // name of the server
  const servername = methodInfo.tags["using"] || "server";
  let rParam = "";
  if (methodInfo.tags.custom != null) {
    wr.out(
      `await ${servername}(req, res).${methodName}(${rParam}${paramList});`,
      true
    );
  } else {
    wr.out(
      `res.json( await ${servername}(req, res).${methodName}(${rParam}${paramList}) );`,
      true
    );
  }
  wr.indent(-1);
  wr.out("} catch(e) {", true);
  wr.indent(1);
  wr.out("res.status(e.statusCode || 400);", true);
  //wr.out(`res.json( e );`, true);
  wr.indent(-1);
  wr.out("}", true);
  wr.indent(-1);
  wr.out(`})`, true);

  if (clientWriter) {
    const writeClientNode = (wr: R.CodeWriter) => {
      if (bodyParams.length > 1)
        throw "Only one post parameter allowed " + method.getName();
      const postParamsStr = bodyParams
        .map(project => project.getName())
        .join(", ");
      // setting the body / post varas is not as simple...
      const pathGetVars = pathParams
        .map(param => "${" + param.getName() + "}")
        .join("/");
      const axiosGetVars =
        `{params:{` +
        queryParams.map(project => project.getName()).join(", ") +
        "}}";

      let apiPath = "";
      path.forEach((pathPart, i) => {
        apiPath += pathPart + "/";
        if (pathParams[i]) {
          apiPath += "${" + pathParams[i].getName() + "}" + "/";
        }
      });
      /*      
   wr.out('return (await axios.post(`/v1/' + methodName + '/'+ axiosGetVars+ '`,'+postParamsStr+')).data;', true)
  */

      wr.out(`// client for endpoint ${methodName}`, true);
      const signatureStr = method
        .getParameters()
        .map(p => p.getName() + ":" + p.getTypeNode().print())
        .join(", ");
      wr.out(
        `async ${methodName}(${signatureStr}) ${
          method.getReturnTypeNode()
            ? ": " + method.getReturnTypeNode().print()
            : ""
        } {`,
        true
      );
      wr.indent(1);
      if (httpMethod === "post" || httpMethod === "put") {
        wr.out(
          "return (await axios." +
            httpMethod +
            "(`" +
            basePath +
            apiPath +
            "`," +
            postParamsStr +
            ")).data;",
          true
        );
      } else {
        wr.out(
          "return (await axios." +
            httpMethod +
            "(`" +
            basePath +
            apiPath +
            "`," +
            axiosGetVars +
            ")).data;",
          true
        );
      }
      wr.indent(-1);
      wr.out(`}`, true);
    };
    writeClientNode(clientWriter);
  }

  const rArr = getTypePath(method.getReturnType());
  const is_array = rArr[0] === "Array";
  const rType = rArr.pop();
  const successResponse = {};
  const definitions: { [key: string]: any } = {};
  const hasProcessed: { [key: string]: boolean } = {};

  const createClassDef = (className: string) => {
    if (hasProcessed[className]) {
      return;
    }
    hasProcessed[className] = true;
    const modelClass = utils.findModel(project, className);

    // Writing the model...

    // TODO: find out how to fix this in TypeScript, this if and the if below repeat
    // code too much...
    if (
      modelClass instanceof ClassDeclaration &&
      !definitions[modelClass.getName()]
    ) {
      // const method = modelClass.addMethod({ isStatic: true, name: "myMethod", returnType: "string" });
      // method.setBodyText( )

      models[modelClass.getName()] = modelClass;
      const props = modelClass.getProperties();
      modelClass.getSourceFile();
      definitions[modelClass.getName()] = {
        type: "object",
        properties: {
          ...props.reduce((prev, curr) => {
            curr.getJsDocs().forEach(doc => {
              console.log("Property comment", curr.getName(), doc.getComment());
            });
            const rArr = getTypePath(curr.getType());
            const is_array = rArr[0] === "Array";
            const rType = rArr.pop();
            const swType = getSwaggerType(rType, is_array);
            createClassDef(rType);
            return {
              ...prev,
              [curr.getName()]: {
                ...swType
              }
            };
          }, {})
        }
      };
    }
    if (
      modelClass instanceof InterfaceDeclaration &&
      !definitions[modelClass.getName()]
    ) {
      models[modelClass.getName()] = modelClass;
      const props = modelClass.getProperties();
      definitions[modelClass.getName()] = {
        type: "object",
        properties: {
          ...props.reduce((prev, curr) => {
            const rArr = getTypePath(curr.getType());
            const is_array = rArr[0] === "Array";
            const rType = rArr.pop();
            const swType = getSwaggerType(rType, is_array);
            createClassDef(rType);
            return {
              ...prev,
              [curr.getName()]: {
                ...swType
              }
            };
          }, {})
        }
      };
    }
  };

  successResponse["200"] = {
    description: "",
    schema: {
      ...getSwaggerType(rType, is_array)
    }
  };
  Object.keys(methodInfo.errors).forEach(code => {
    successResponse[code] = {
      description: "",
      schema: {
        ...getSwaggerType(methodInfo.errors[code], false)
      }
    };
    createClassDef(methodInfo.errors[code]);
  });
  createClassDef(rType);
  // generate swagger docs of this endpoin, a simple version so far
  const state = wr.getState().swagger;
  const validParams = method.getParameters();

  // build the path for swagger
  let swaggerPath = "";
  path.forEach((pathPart, i) => {
    swaggerPath += "/" + pathPart;
    if (pathParams[i]) {
      swaggerPath += "/{" + pathParams[i].getName() + "}";
    }
  });

  // the old simple mapping...
  // const axiosGetVars = getParams.map( param => ('{' + param.getName() + '}' ) ).join('/')

  const taglist = [];
  if (methodInfo.tags.tag) {
    taglist.push(methodInfo.tags.tag);
    addTag(methodInfo.tags.tag, "");
    addTagDescription(methodInfo.tags.tag, methodInfo.tags.tagdescription);
  }

  const fileParams: { tag: string; value: string }[] = [];
  const fileMetaParams: { tag: string; value: string }[] = [];

  if (methodInfo.tags.upload) {
    fileParams.push({ tag: "upload", value: methodInfo.tags.upload });
  }
  if (methodInfo.tags.uploadmeta) {
    fileMetaParams.push({
      tag: "uploadmeta",
      value: methodInfo.tags.uploadmeta
    });
  }
  // NOTE: in Swagger parameter types are
  // -path
  // -query
  // -header (not implemented)
  // -cookie (not implemented)
  const previous = state.paths[swaggerPath];
  state.paths[swaggerPath] = {
    ...previous,
    [httpMethod]: {
      parameters: [
        ...fileParams.map(item => {
          return {
            name: item.value,
            in: "formData",
            description: "Uploaded file",
            required: true,
            type: "file"
          };
        }),
        ...fileMetaParams.map(item => {
          return {
            name: item.value,
            in: "formData",
            description: methodInfo.tags.uploadmetadesc || "",
            required: true,
            type: "string"
          };
        }),
        ...pathParams.map(param => {
          return {
            name: param.getName(),
            in: "path",
            description: methodInfo.tags[param.getName()] || "",
            required: true,
            type: getTypeName(param.getType())
          };
        }),
        ...queryParams.map(param => {
          return {
            name: param.getName(),
            in: "query",
            description: methodInfo.tags[param.getName()] || "",
            required: !param.isOptional(),
            type: getTypeName(param.getType())
          };
        }),
        ...bodyParams.map(param => {
          const rArr = getTypePath(param.getType());
          const is_array = rArr[0] === "Array";
          const rType = rArr.pop();
          let tDef: any = {
            schema: {
              ...getSwaggerType(rType, is_array)
            }
          };
          if (isSimpleType(param.getType())) {
            tDef = {
              type: rType
            };
          } else {
            createClassDef(rType);
          }
          return {
            name: param.getName(),
            in: "body",
            description: methodInfo.tags[param.getName()] || "",
            required: !param.isOptional(),
            ...tDef
          };
        })
      ],
      description: methodInfo.tags.description || methodInfo.comment,
      summary:
        methodInfo.tags.summary ||
        methodInfo.tags.description ||
        methodInfo.comment,
      produces: ["application/json"],
      responses: {
        ...successResponse
      },
      tags: taglist
    }
  };
  state.definitions = Object.assign(state.definitions, definitions);
  return wr;
};

export const createValidatorFor = (
  wr: R.CodeWriter,
  name: string,
  param: ParameterDeclaration
): string => {
  // check for ID values too ?
  const n = param.getName();
  const maybe = "maybe_" + n;
  if (getTypeName(param.getType()) === "number") {
    wr.out(`const ${maybe}:any = parseInt(String(${name})) `, true);
    wr.out(
      `const ${n}:number | null = (!isNaN(${maybe}) && (Number.isInteger(${maybe})) && (${maybe} >= 0)) ? ${maybe} : null`,
      true
    );
    wr.out(`if(${n} === null) throw({statusCode:422})`, true);
    return n;
  }
  if (getTypeName(param.getType()) === "string") {
    wr.out(`if(typeof ${name} !== 'string') throw({statusCode:422})`, true);
    return name;
  }
  if (getTypeName(param.getType()) === "boolean") {
    wr.out(
      `const ${n}:any = ${name} === "true" ? true : ${name} === "false" ? false : ${name}`,
      true
    );
    wr.out(`if(typeof ${n} !== 'boolean') throw({statusCode:422})`, true);
    return n;
  }
  return name;
};

// write axios client endpoint for method
export const WriteClient = (
  wr: R.CodeWriter,
  project: Project,
  clName: ClassDeclaration,
  method: MethodDeclaration
): R.CodeWriter => {
  const methodInfo = getMethodDoc(method);
  if (methodInfo.tags.nogenerate) return wr;

  let methodName = method.getName();
  // only simple parameters
  const validParams = method.getParameters();
  const getParams = method
    .getParameters()
    .filter(param => isSimpleType(param.getType()));
  const postParams = method
    .getParameters()
    .filter(param => !isSimpleType(param.getType()));
  const is_post =
    method.getParameters().filter(project => !isSimpleType(project.getType()))
      .length > 0;
  let httpMethod = is_post ? "post" : "get";
  // method signature
  const signatureStr = validParams
    .map(p => {
      return p.getName() + `: ` + p.getTypeNode().print();
    })
    .join(", ");
  const paramsStr = getParams.map(project => project.getName()).join(", ");
  const postParamsStr = postParams.map(project => project.getName()).join(", ");

  // setting the body / post varas is not as simple...
  const axiosGetVars = getParams
    .map(param => "${" + param.getName() + "}")
    .join("/");

  if (methodInfo.tags.method) {
    httpMethod = methodInfo.tags.method;
  }
  if (methodInfo.tags.alias) {
    methodName = methodInfo.tags.alias;
  }
  switch (httpMethod) {
    case "post":
      wr.out(`// Service endpoint for ${methodName}`, true);
      wr.out(
        `async ${methodName}(${signatureStr}) : Promise<${getTypeName(
          method.getReturnType()
        )}> {`,
        true
      );
      wr.indent(1);
      if (is_post) wr.out("// should be posted", true);
      wr.out(
        "return (await axios.post(`/v1/" +
          methodName +
          "/" +
          axiosGetVars +
          "`," +
          postParamsStr +
          ")).data;",
        true
      );
      wr.indent(-1);
      wr.out(`}`, true);
      break;
    case "get":
      wr.out(`// Service endpoint for ${methodName}`, true);
      wr.out(
        `async ${methodName}(${signatureStr}) : Promise<${getTypeName(
          method.getReturnType()
        )}> {`,
        true
      );
      wr.indent(1);
      if (is_post) wr.out("// should be posted", true);
      wr.out(
        "return (await axios.get(`/v1/" +
          methodName +
          "/" +
          axiosGetVars +
          "`)).data;",
        true
      );
      wr.indent(-1);
      wr.out(`}`, true);
      break;
    default:
      wr.out(`// Service endpoint for ${methodName}`, true);
      wr.out(
        `async ${methodName}(${signatureStr}) : Promise<${getTypeName(
          method.getReturnType()
        )}> {`,
        true
      );
      wr.indent(1);
      if (is_post) wr.out("// should be posted", true);
      wr.out(
        "return (await axios." +
          httpMethod +
          "(`/v1/" +
          methodName +
          "/" +
          axiosGetVars +
          "`)).data;",
        true
      );
      wr.indent(-1);
      wr.out(`}`, true);
  }
  return wr;
};

// write axios client endpoint for method
export const WriteClientEndpoint = (
  wr: R.CodeWriter,
  project: Project,
  clName: ClassDeclaration,
  method: MethodDeclaration
): R.CodeWriter => {
  const methodInfo = getMethodDoc(method);
  if (methodInfo.tags.nogenerate) return wr;

  let methodName = method.getName();
  // only simple parameters
  const validParams = method.getParameters();
  const getParams = method
    .getParameters()
    .filter(param => isSimpleType(param.getType()));
  const postParams = method
    .getParameters()
    .filter(param => !isSimpleType(param.getType()));
  const is_post =
    method.getParameters().filter(project => !isSimpleType(project.getType()))
      .length > 0;
  let httpMethod = is_post ? "post" : "get";
  // method signature
  const signatureStr = validParams
    .map(p => {
      return p.getName() + `: ` + p.getTypeNode().print();
    })
    .join(", ");
  const paramsStr = getParams.map(project => project.getName()).join(", ");
  const postParamsStr = postParams.map(project => project.getName()).join(", ");

  // setting the body / post varas is not as simple...
  const axiosGetVars = getParams
    .map(param => "${" + param.getName() + "}")
    .join("/");

  if (methodInfo.tags.method) {
    httpMethod = methodInfo.tags.method;
  }
  if (methodInfo.tags.alias) {
    methodName = methodInfo.tags.alias;
  }
  switch (httpMethod) {
    case "post":
      wr.out(`// Service endpoint for ${methodName}`, true);
      wr.out(
        `async ${methodName}(${signatureStr}) : Promise<${getTypeName(
          method.getReturnType()
        )}> {`,
        true
      );
      wr.indent(1);
      if (is_post) wr.out("// should be posted", true);
      wr.out(
        "return (await axios.post(`/v1/" +
          methodName +
          "/" +
          axiosGetVars +
          "`," +
          postParamsStr +
          ")).data;",
        true
      );
      wr.indent(-1);
      wr.out(`}`, true);
      break;
    case "get":
      wr.out(`// Service endpoint for ${methodName}`, true);
      wr.out(
        `async ${methodName}(${signatureStr}) : Promise<${getTypeName(
          method.getReturnType()
        )}> {`,
        true
      );
      wr.indent(1);
      if (is_post) wr.out("// should be posted", true);
      wr.out(
        "return (await axios.get(`/v1/" +
          methodName +
          "/" +
          axiosGetVars +
          "`)).data;",
        true
      );
      wr.indent(-1);
      wr.out(`}`, true);
      break;
    default:
      wr.out(`// Service endpoint for ${methodName}`, true);
      wr.out(
        `async ${methodName}(${signatureStr}) : Promise<${getTypeName(
          method.getReturnType()
        )}> {`,
        true
      );
      wr.indent(1);
      if (is_post) wr.out("// should be posted", true);
      wr.out(
        "return (await axios." +
          httpMethod +
          "(`/v1/" +
          methodName +
          "/" +
          axiosGetVars +
          "`)).data;",
        true
      );
      wr.indent(-1);
      wr.out(`}`, true);
  }
  return wr;
};

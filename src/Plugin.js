/* eslint-disable */
import { join } from 'path';
import { addSideEffect, addDefault, addNamed } from '@babel/helper-module-imports';
const iviewModule = require('./iview').iviewModule

function camel2Dash(_str) {
  const str = _str[0].toLowerCase() + _str.substr(1);
  return str.replace(/([A-Z])/g, ($1) => `-${$1.toLowerCase()}`);
}

function camel2Underline(_str) {
  const str = _str[0].toLowerCase() + _str.substr(1);
  return str.replace(/([A-Z])/g, ($1) => `_${$1.toLowerCase()}`);
}

function winPath(path) {
  return path.replace(/\\/g, '/');
}

export default class Plugin {
  constructor(
    libraryName,
    libraryDirectory,
    style,
    camel2DashComponentName,
    camel2UnderlineComponentName,
    fileName,
    customName,
    transformToDefaultImport,
    types,
    load,
    index = 0
  ) {
    this.libraryName = libraryName;
    this.libraryDirectory = typeof libraryDirectory === 'undefined'
      ? 'lib'
      : libraryDirectory;
    this.camel2DashComponentName = typeof camel2DashComponentName === 'undefined'
      ? true
      : camel2DashComponentName;
    this.camel2UnderlineComponentName = camel2UnderlineComponentName;
    this.style = style || false;
    this.fileName = fileName || '';
    this.customName = customName;
    this.transformToDefaultImport = typeof transformToDefaultImport === 'undefined'
      ? true
      : transformToDefaultImport;
    this.types = types;
    this.pluginStateKey = `importPluginState${index}`;
    this.load = typeof load === 'undefined' ? false : load;
  }

  getPluginState(state) {
    if (!state[this.pluginStateKey]) {
      state[this.pluginStateKey] = {};  // eslint-disable-line
    }
    return state[this.pluginStateKey];
  }

  isInGlobalScope(path, name, pluginState) {
    const parentPath = path.findParent((_path) =>
    _path.scope.hasOwnBinding(pluginState.specified[name]));
    return !!parentPath && parentPath.isProgram();
  }

  importMethod(methodName, file, pluginState) {
    if (!pluginState.selectedMethods[methodName]) {
      const libraryDirectory = this.libraryDirectory;
      const style = this.style;
      const transformedMethodName = this.camel2UnderlineComponentName  // eslint-disable-line
        ? camel2Underline(methodName)
        : this.camel2DashComponentName
          ? camel2Dash(methodName)
          : methodName;
      const path = winPath(
        this.customName ? this.customName(transformedMethodName) : join(this.libraryName, libraryDirectory, transformedMethodName, this.fileName) // eslint-disable-line
      );
      pluginState.selectedMethods[methodName] = this.transformToDefaultImport  // eslint-disable-line
        ? addDefault(file.path, path, { nameHint: methodName })
        : addNamed(file.path, methodName, path);
      if (style === true) {
        addSideEffect(file.path, `${path}/style`);
      } else if (style === 'css') {
        addSideEffect(file.path, `${path}/style/css`);
      } else if (typeof style === 'function') {
        const stylePath = style(path, file);
        if (stylePath) {
          addSideEffect(file.path, stylePath);
        }
      }
    }
    return Object.assign({}, pluginState.selectedMethods[methodName]);
  }

  buildExpressionHandler(node, props, path, state) {
    const file = (path && path.hub && path.hub.file) || (state && state.file);
    const types = this.types;
    const pluginState = this.getPluginState(state);
    props.forEach(prop => {
      if (!types.isIdentifier(node[prop])) return;
      if (pluginState.specified[node[prop].name]) {
        node[prop] = this.importMethod(pluginState.specified[node[prop].name], file, pluginState);  // eslint-disable-line
      }
    });
  }

  buildDeclaratorHandler(node, prop, path, state) {
    const file = (path && path.hub && path.hub.file) || (state && state.file);
    const types = this.types;
    const pluginState = this.getPluginState(state);
    if (!types.isIdentifier(node[prop])) return;
    if (pluginState.specified[node[prop].name] &&
      path.scope.hasBinding(node[prop].name) &&
      path.scope.getBinding(node[prop].name).path.type === 'ImportSpecifier') {
      node[prop] = this.importMethod(node[prop].name, file, pluginState);  // eslint-disable-line
    }
  }

  ProgramEnter(path, state) {
    const pluginState = this.getPluginState(state);
    pluginState.specified = Object.create(null);
    pluginState.libraryObjs = Object.create(null);
    pluginState.selectedMethods = Object.create(null);
    pluginState.pathsToRemove = [];
  }

  ProgramExit(path, state) {
    this.getPluginState(state).pathsToRemove.forEach(p => !p.removed && p.remove());
  }

  ImportDeclaration(path, state) {
    const node = path.node; // path maybe removed by prev instances.

    if (!node) return;
    const value = node.source.value;
    const libraryName = this.libraryName;
    const types = this.types;
    const pluginState = this.getPluginState(state);
    let flag = false
    let indexOfSpec = 0

    if (value === libraryName) {
      const newExps = []
      const newImports = []
      const cssImports = []
      switch (this.libraryName) {
        case 'iview':
          if (this.style === true) {
            this.style = false
            cssImports.push('iview/src/styles/index.less');
          } else if (this.style === 'css') {
            this.style = false
            cssImports.push('iview/dist/styles/iview.css');
          }
          break;
        default:
          break;
      }
      node.specifiers.forEach((spec, index) => {
        indexOfSpec = index
        if (types.isImportSpecifier(spec)) {
          pluginState.specified[spec.local.name] = spec.imported.name;
          if (this.load === 'auto' && iviewModule[spec.imported.name]) { // iview: import { Circle, Table } from 'iview'
            const _modules = iviewModule[spec.imported.name]
            for (const m of _modules) {
              newExps.push({
                key: spec.imported.name,
                value: m,
              });
            }
          }
        } else if (types.isImportDefaultSpecifier(spec)) { // iview: import iView from 'iview'
          if (this.load === 'auto') {
            for (const n of Object.keys(iviewModule)) {
              const _modules = iviewModule[n]
              for (const m of _modules) {
                newExps.push({
                  key: n,
                  value: m,
                });
              }
              newImports.push(n);
            }
          } else {
            flag = true;
          }
        } else {
          pluginState.libraryObjs[spec.local.name] = true;
        }
      });
      if (this.load === 'auto') {
        switch (libraryName) {
          case 'iview':
            const asts = []
            // 生成 import Affix from "iview/src/components/affix";...
            for (const name of newImports) {
              const transformedMethodName = this.camel2UnderlineComponentName // eslint-disable-line
                ? camel2Underline(name) : this.camel2DashComponentName ? camel2Dash(name) : name;
              const path = winPath(this.customName ? this.customName(transformedMethodName) : (0, _path2.join)(this.libraryName, this.libraryDirectory, transformedMethodName, this.fileName)); // eslint-disable-line
              asts.push(types.importDeclaration([types.importDefaultSpecifier(types.identifier(name))], types.stringLiteral(path)));
            }
            // 生成 Vue.component("Affix", Affix);...
            for (const exp of newExps) {
              asts.push(types.expressionStatement(
                types.callExpression(
                  types.memberExpression(types.identifier('Vue'), types.identifier('component')),
                  [types.stringLiteral(exp.value), types.identifier(exp.key)]
                )
              ));
            }
            for (const css of cssImports) {
              asts.push(types.importDeclaration([], types.stringLiteral(css)));
            }
            path.replaceWithMultiple(asts)
            break;
          default:
            break;
        }
      } else if ((indexOfSpec === (node.specifiers.length - 1)) && cssImports && cssImports.length) {
        const asts = []
        for (const css of cssImports) {
          asts.push(types.importDeclaration([], types.stringLiteral(css)));
        }
        path.replaceWithMultiple(asts);
      } else if (!flag) {
        pluginState.pathsToRemove.push(path);
      }
    }
  }

  CallExpression(path, state) {
    const { node } = path;
    const file = (path && path.hub && path.hub.file) || (state && state.file);
    const { name } = node.callee;
    const types = this.types;
    const pluginState = this.getPluginState(state);

    if (types.isIdentifier(node.callee)) {
      if (pluginState.specified[name]) {
        node.callee = this.importMethod(pluginState.specified[name], file, pluginState);
      }
    }

    node.arguments = node.arguments.map(arg => {
      const { name: argName } = arg;
      if (pluginState.specified[argName] &&
        path.scope.hasBinding(argName) &&
        path.scope.getBinding(argName).path.type === 'ImportSpecifier') {
        return this.importMethod(pluginState.specified[argName], file, pluginState);
      }
      return arg;
    });
  }

  MemberExpression(path, state) {
    const { node } = path;
    const file = (path && path.hub && path.hub.file) || (state && state.file);
    const pluginState = this.getPluginState(state);

    // multiple instance check.
    if (!node.object || !node.object.name) return;

    if (pluginState.libraryObjs[node.object.name]) {
      // antd.Button -> _Button
      path.replaceWith(this.importMethod(node.property.name, file, pluginState));
    } else if (pluginState.specified[node.object.name]) {
      node.object = this.importMethod(pluginState.specified[node.object.name], file, pluginState);
    }
  }

  Property(path, state) {
    const { node } = path;
    this.buildDeclaratorHandler(node, 'value', path, state);
  }

  VariableDeclarator(path, state) {
    const { node } = path;
    this.buildDeclaratorHandler(node, 'init', path, state);
  }

  ArrayExpression(path, state) {
    const { node } = path;
    const props = node.elements.map((_, index) => index);
    this.buildExpressionHandler(node.elements, props, path, state);
  }

  LogicalExpression(path, state) {
    const { node } = path;
    this.buildExpressionHandler(node, ['left', 'right'], path, state);
  }

  ConditionalExpression(path, state) {
    const { node } = path;
    this.buildExpressionHandler(node, ['test', 'consequent', 'alternate'], path, state);
  }

  IfStatement(path, state) {
    const { node } = path;
    this.buildExpressionHandler(node, ['test'], path, state);
    this.buildExpressionHandler(node.test, ['left', 'right'], path, state);
  }

  ExpressionStatement(path, state) {
    const { node } = path;
    const { types } = this;
    if (types.isAssignmentExpression(node.expression)) {
      this.buildExpressionHandler(node.expression, ['right'], path, state);
    }
  }

  ReturnStatement(path, state) {
    const types = this.types;
    const file = (path && path.hub && path.hub.file) || (state && state.file);
    const { node } = path;
    const pluginState = this.getPluginState(state);

    if (node.argument && types.isIdentifier(node.argument) &&
    pluginState.specified[node.argument.name] &&
    this.isInGlobalScope(path, node.argument.name, pluginState)) {
      node.argument = this.importMethod(node.argument.name, file, pluginState);
    }
  }

  ExportDefaultDeclaration(path, state) {
    const { node } = path;
    this.buildExpressionHandler(node, ['declaration'], path, state);
  }

  BinaryExpression(path, state) {
    const { node } = path;
    this.buildExpressionHandler(node, ['left', 'right'], path, state);
  }

  NewExpression(path, state) {
    const { node } = path;
    this.buildExpressionHandler(node, ['callee', 'arguments'], path, state);
  }
}

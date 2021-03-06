import * as yargs from 'yargs';
import * as R from 'ramda';
import * as xiberia from '../xiberia.local';
import * as helpers from '../../lib/utils/helpers';

export function defaultOptionHandler (yin: yargs.Argv, optionName: string, optionDef: { [key: string]: any },
  positional: boolean)
  : yargs.Argv {
  return positional
    ? yin.positional(optionName, optionDef)
    : yin.option(optionName, optionDef);
}

export function defaultBeforeCommandHandler (yin: yargs.Argv, commandDescription: string,
  helpDescription: string, adaptedCommand: { [key: string]: any })
  : yargs.Argv {
  return yin;
}

export function defaultAfterCommandHandler (yin: yargs.Argv)
  : yargs.Argv {
  return yin;
}

export function defaultFailHandler (msg: string, err: Error, yin: yargs.Argv, ac: any)
  : yargs.Argv {
  return yin;
}

export const defaultHandlers: xiberia.IYargsInternalBuildHandlers = {
  onOption: defaultOptionHandler,
  onBeforeCommand: defaultBeforeCommandHandler,
  onAfterCommand: defaultAfterCommandHandler,
  onFail: defaultFailHandler
};

function resolve (local: xiberia.IYargsOptionHandler | undefined, member: xiberia.IYargsOptionHandler)
  : xiberia.IYargsOptionHandler {
  return local ?? member;
}

// ==============================================================================

/**
 * @export
 * @class YargsBuilderImpl
 */
export class YargsBuilderImpl {
  /**
   * @description Creates an instance of YargsBuilderImpl.
   * @param {types.IAeYargsSchema} schema
   * @param {types.IYargsBuildHandlers} [handlers]
   * @memberof YargsBuilderImpl
   */
  constructor (private schema: xiberia.IJsonConversionSchema, handlers?: xiberia.IYargsBuildHandlers) {
    if (!handlers) {
      this.handlers = { // xib.IAeYargsInternalBuildHandlers
        onOption: defaultOptionHandler,
        onBeforeCommand: defaultBeforeCommandHandler,
        onAfterCommand: defaultAfterCommandHandler,
        onFail: defaultFailHandler
      };
    } else {
      this.handlers = {
        onOption: handlers.onOption ?? defaultHandlers.onOption,
        onBeforeCommand: handlers.onBeforeCommand ?? defaultHandlers.onBeforeCommand,
        onAfterCommand: handlers.onAfterCommand ?? defaultHandlers.onAfterCommand,
        onFail: handlers.onFail ?? defaultHandlers.onFail
      };
    }
  }

  readonly handlers: xiberia.IYargsInternalBuildHandlers;
  defaultCommand: string;

  /**
   * @method buildCommand
   * @description
   *
   * @param {yargs.Argv} instance
   * @param {{ [key: string]: any }} adaptedCommand
   * @param {types.IAeYargsOptionHandler} [optionHandler]
   * @returns {yargs.Argv}
   * @memberof YargsBuilderImpl
   */
  public buildCommand (instance: yargs.Argv, adaptedCommand: { [key: string]: any },
    optionHandler?: xiberia.IYargsOptionHandler)
    : yargs.Argv {
    return this.command(instance.fail((m: string, e: Error, yin: yargs.Argv): yargs.Argv => {
      return this.handlers.onFail(m, e, yin, adaptedCommand);
    }), adaptedCommand, optionHandler);
  } // buildCommand

  /**
   * @method command
   * @description Builds the command
   *
   * @param {yargs.Argv} instance
   * @param {*} adaptedCommand
   * @param {types.IAeYargsOptionHandler} [optionHandler]
   * @returns {yargs.Argv}
   * @memberof YargsBuilderImpl
   */
  public command (instance: yargs.Argv, adaptedCommand: { [key: string]: any },
    optionHandler?: xiberia.IYargsOptionHandler)
    : yargs.Argv {
    const commandName: string = R.prop(this.schema.labels.commandNameId)(adaptedCommand);
    const helpDescription: string = R.prop('describe')(adaptedCommand as { describe: string });
    const descendants: any[] = R.prop(this.schema.labels.descendants)(adaptedCommand);

    const commandArgumentsObj = helpers.findDescendant(
      this.schema.labels.commandOptions, descendants, this.schema.labels.elements);
    const argumentsDescendants: any = R.prop(this.schema.labels.descendants)(commandArgumentsObj);

    const positionalDef: string = R.prop('positional')(adaptedCommand as { positional: string });
    const commandDescription = positionalDef
      ? this.decoratePositionalDef(commandName, positionalDef, argumentsDescendants)
      : commandName;

    let result = this.handlers.onBeforeCommand(instance, commandDescription, helpDescription, adaptedCommand);

    const builder = (yin: yargs.Argv): yargs.Argv => {
      if (positionalDef) {
        yin = this.handlePositional(yin, positionalDef, argumentsDescendants, adaptedCommand);
      }

      yin = this.handleOptions(yin, positionalDef, argumentsDescendants, adaptedCommand, optionHandler);

      const validationGroupsObj = helpers.findDescendant(
        this.schema.labels.validationGroups, descendants, this.schema.labels.elements);

      if (validationGroupsObj) {
        const groupsDescendants: any = R.prop(this.schema.labels.descendants)(validationGroupsObj);
        yin = this.handleValidationGroups(yin, groupsDescendants);
      }
      return yin;
    };

    result = result.command(commandDescription, helpDescription, builder);
    result = this.handlers.onAfterCommand(result);

    if (R.has('default')(adaptedCommand)) {
      if (this.defaultCommand) {
        throw new Error(
          `Can't set default command to "${commandName}"; already been defined as "${this.defaultCommand}"`);
      }
      this.defaultCommand = commandName;
      const defaultValue = R.prop('default')(adaptedCommand as { default: boolean });
      if (defaultValue) {
        result = result.command([commandName, '$0'], helpDescription, builder);
      }
    }

    return result;
  } // command

  /**
   * @method decoratePositionalDef
   * @description Creates the positional definition string, required to create
   * the command. The positional definition should not contain mandatory/optional
   * indicators, rather, that is specified in the argument definition which this method
   * picks up and applies accordingly.
   *
   * @public
   * @param {string} commandName
   * @param {string} positionalStr
   * @param {{ [key: string]: {}}} argumentsMap
   * @returns {string}
   * @memberof YargsBuilderImpl
   */
  public decoratePositionalDef (commandName: string,
    positionalStr: string,
    argumentsMap: { [key: string]: {}})
    : string {
    if (!positionalStr || positionalStr === '') {
      return '';
    }
    const positionalArguments = R.split(' ')(positionalStr);
    const def = R.reduce((acc: string, argument: string): string => {
      const argumentDef: any = argumentsMap[argument];

      if (argumentDef) {
        if (argumentDef instanceof Object) {
          const demanded = R.defaultTo(false, R.prop('demandOption')(argumentDef));
          const result = demanded ? `<${argument}> ` : `[${argument}] `;

          return R.concat(acc, result);
        } else {
          throw new Error(`Decorating; positional argument: "${argument}" not defined as an object.`);
        }
      } else {
        throw new Error(`Decorating; positional argument: "${argument}" not found`);
      }
    }, '')(positionalArguments);

    return (`${commandName} ${def.trim()}`).trim();
  } // positionalDef

  /**
   * @method handlePositional
   * @description Processes the positional directive on the command. By the time
   * we get into this method, we already know that all positional arguments have
   * been correctly defined, because the positional definition for the command has
   * already been created.
   *
   * @param {yargs.Argv} instance
   * @param {string} positionalStr
   * @param {{ [key: string]: {} }} argumentsMap
   * @param {{ [key: string]: any }} adaptedCommand
   * @param {types.IAeYargsOptionHandler} [optionHandler]
   * @returns {yargs.Argv}
   * @memberof YargsBuilderImpl
   */
  public handlePositional (instance: yargs.Argv,
    positionalStr: string,
    argumentsMap: { [key: string]: {} },
    adaptedCommand: { [key: string]: any },
    optionHandler?: xiberia.IYargsOptionHandler)
    : yargs.Argv {
    let result = instance;

    if (positionalStr && positionalStr !== '') {
      const positionalArguments = (R.split(' ')(positionalStr));

      result = R.reduce((acc: yargs.Argv, argument: string): yargs.Argv => {
        const argumentDef: { [key: string]: any } = argumentsMap[argument];
        return this.positional(acc, argument, argumentDef, adaptedCommand, optionHandler);
      }, result)(positionalArguments);
    }

    return result;
  } // handlePositional

  /**
   * @method positional
   * @description Invokes positional on the yargs instance for the argument name
   * specified.
   *
   * @public
   * @param {yargs.Argv} instance
   * @param {string} argumentName
   * @param {*} argumentDef
   * @param {{ [key: string]: any }} adaptedCommand
   * @param {types.IAeYargsOptionHandler} [optionHandler]
   * @returns {yargs.Argv}
   * @memberof YargsBuilderImpl
   */
  public positional (instance: yargs.Argv, argumentName: string,
    argumentDef: { [key: string]: any }, adaptedCommand: { [key: string]: any },
    optionHandler?: xiberia.IYargsOptionHandler)
  : yargs.Argv {
    const IS_POSITIONAL = true;

    const result = resolve(optionHandler, this.handlers.onOption)(
      instance, argumentName, argumentDef, IS_POSITIONAL, adaptedCommand, defaultOptionHandler);

    return result;
  } // positional

  /**
   * @method handleOptions
   * @description
   *
   * @public
   * @param {yargs.Argv} instance
   * @param {string} positionalDef
   * @param {*} argumentsMap
   * @param {types.IAeYargsOptionHandler} [optionHandler]
   * @returns {yargs.Argv}
   * @memberof YargsBuilderImpl
   */
  public handleOptions (instance: yargs.Argv,
    positionalDef: string,
    argumentsMap: { [key: string]: any },
    adaptedCommand: { [key: string]: any },
    optionHandler?: xiberia.IYargsOptionHandler)
  : yargs.Argv {
    const NON_POSITIONAL = false;

    // first need to remove the positional arguments as they have already been
    // processed.
    //
    const nonPositional = helpers.pickArguments(argumentsMap, positionalDef ?? '');

    const result = R.reduce((acc: yargs.Argv, pair: [string, any]): yargs.Argv => {
      const argumentName = pair[0];
      const argumentDef: { [key: string]: any } = pair[1];

      return resolve(optionHandler, this.handlers.onOption)(
        acc, argumentName, argumentDef, NON_POSITIONAL, adaptedCommand, defaultOptionHandler);
    }, instance)(R.toPairs(nonPositional));

    return result;
  } // handleOptions

  /**
   * @method handleValidationGroups
   * @description
   *
   * @public
   * @param {yargs.Argv} instance
   * @param {*} validationGroups
   * @returns {yargs.Argv}
   * @memberof YargsBuilderImpl
   */
  public handleValidationGroups (instance: yargs.Argv, validationGroups: { [key: string]: any }[])
    : yargs.Argv {
    const result = R.reduce((validatorAcc: yargs.Argv, validator: { [key: string]: any }): yargs.Argv => {
      const validatorDescendants: any = validator[this.schema.labels.descendants];
      const validatorType: string = validator[this.schema.labels.elements];

      if (R.includes(validatorType)(['Conflicts', 'Implies'])) {
        const get = (argumentRef: { [key: string]: any }) => argumentRef[this.schema.labels.commandNameId];
        /* istanbul ignore next: wtf? */
        const equals = (a: { [key: string]: any }, b: { [key: string]: any }): boolean => {
          /* istanbul ignore next: wtf? */
          return a[this.schema.labels.commandNameId] === b[this.schema.labels.commandNameId];
        };

        const pairs = helpers.uniquePairs(validatorDescendants, get, equals);

        validatorAcc = R.reduce((innerAcc: yargs.Argv, pair: any): yargs.Argv => {
          switch (validatorType) {
            case 'Conflicts':
              innerAcc.conflicts(pair[0], pair[1]);
              break;
            case 'Implies':
              innerAcc.implies(pair[0], pair[1]);
              break;
          }
          return innerAcc;
        }, validatorAcc)(pairs);
      }
      return validatorAcc;
    }, instance)(validationGroups);

    return result;
  } // handleValidationGroups
} // YargsBuilderImpl

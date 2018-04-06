#!/usr/bin/env node

var program = require('commander');
var chalk = require('chalk');
var secretserver = require('@mr.xcray/thycotic-secretserver-client');
var jmespath = require('jmespath');
var Promise = require('bluebird');
var readlineSync = require('readline-sync');
var yaml = require('js-yaml');
var fs = require('fs');
var path = require('path');
var _ = require('lodash');

// program
//   .arguments('<secret-id> [secret-id ...]')
//   .version('0.1.0', '-v, --version')
//   .option('-u, --username <username>', 'Username with which to authenticate against secret server')
//   .option('-p, --password <password>', 'Password with which to authenticate against secret server')
//   .option('-w, --wsdl <wsdl-url>', 'URL to the secret server WSDL')
//   .option('-c, --config <config-file>', 'Specify a config file to load')
//   .option('-f, --filter <filter>', 'Filter the JSON output using a JMESPath filter')
//   .option('--pretty', 'Pretty print JSON output')
//   .option('--raw', 'output raw object, useful in conjunction with the --filter option')
//   .option('-s,--simple', 'Output a simplified version of the secret');

program
  .version('0.1.0', '-v, --version')
  .option('-u, --username <username>', 'Username with which to authenticate against secret server.  This can also be supplied via the environment variable SECRETR_USERNAME. If not supplied the user will be prompted.')
  .option('-p, --password <password>', 'Password with which to authenticate against secret server.  This can also be supplied via the environment variable SECRETR_PASSWORD. If not supplied the user will be prompted.')
  .option('-w, --wsdl <wsdl-url>', 'URL to the secret server WSDL.  This can also be supplied via the environment variable SECRETR_WSDL. If not supplied the user will be prompted.');

program.command('get')
  .arguments('<secret-id> [secret-id...]')
  .option('-f, --filter <filter>', 'Filter the JSON output using a JMESPath filter')
  .option('--pretty', 'Pretty print JSON output')
  .option('--raw', 'output raw object, useful in conjunction with the --filter option')
  .option('-s,--simple', 'Output a simplified version of the secret')
  .action(function(firstSecretId, optionalSecretIds, cmd){
    loadGlobals();
    let secretIds = _.concat(firstSecretId, optionalSecretIds);
    console.log('username: %s', program.username);
  });

program.parse(process.argv);

function loadGlobals(){
  program.username = program.username || process.env.SECRETR_USERNAME || readlineSync.question('username: ');
  program.password = program.password || process.env.SECRETR_PASSWORD || readlineSync.question('password: ', {hideEchoBack: true});
  program.wsdl = program.wsdl || process.env.SECRETR_WSDL || readlineSync.question('wsdl: ');
  if( program.wsdl == undefined){
    console.error(chalk.red("WSDL is not defined.  Please specify a WSDL.  See --help for more details"));
    process.exit(1);
  }
  // @mr.xcray/thycotic-secretserver-client does some weird stuff to the input WSDL so we need to make sure things are capitalized correctly
  program.wsdl = program.wsdl.replace(/sswebservice.asmx\?wsdl/i,'SSWebService.asmx?WSDL');
}

process.exit(0);

const secretIds = [];
program.args.forEach( secretId => {
  secretIds.push(secretId);
})

if (program.config){
  var config = yaml.safeLoad(fs.readFileSync(program.config, 'utf8'));
}

let username = program.username || process.env.SECRETR_USERNAME || readlineSync.question('username: ');
let password = program.password || process.env.SECRETR_PASSWORD || readlineSync.question('password: ', {hideEchoBack: true});
let wsdl = (config == undefined ? undefined : config.wsdl) || program.wsdl || process.env.SECRETR_WSDL;
if( wsdl == undefined){
  console.error(chalk.red("WSDL is not defined.  Please specify a WSDL.  See --help for more details"));
  process.exit(1);
}
// @mr.xcray/thycotic-secretserver-client does some weird stuff to the input WSDL so we need to make sure things are capitalized correctly
wsdl = wsdl.replace(/sswebservice.asmx\?wsdl/i,'SSWebService.asmx?WSDL');

function emitOutput(data) {
  if (program.raw){
    console.log(data);    
  }else if(program.pretty){
    console.log(JSON.stringify(data, null, '\t'));
  } else {
    console.log(JSON.stringify(data));
  }
}

function simplifyResult(result) {
  const simpleResult = jmespath.search(result, '{Name: Name, Id: Id}');
  const items = jmespath.search(result, 'Items[*].{FieldName: FieldName, Value: Value}');
  itemDictionary = {}
  items.forEach( item => {
    itemDictionary[item.FieldName] = item.Value;
  })
  simpleResult.Items = itemDictionary;
  return simpleResult;
}

function convertItemsDictionaryToArray(result) {
  const itemNames = jmespath.search(result, 'keys(Items)');
  const itemArray = [];
  itemNames.forEach(itemName => {
    itemArray.push(jmespath.search(result, `Items."${itemName}"`));
  });
  result.Items = itemArray;
  return result;
}

const returnObject = { Secrets: [] };
const client = new secretserver(wsdl, username, password, organization='', domain='vistaprintus');

if(program.config){
  console.log('config file! %s', program.config);
  config.relpath = path.dirname(program.config);
  config.secrets.forEach((configsecret) => {
    client.GetSecret(configsecret.id)
      .then( secret => {
        secret = convertItemsDictionaryToArray(secret);
        if(program.simple){
          secret = simplifyResult(secret);
        }
        let outpath;
        if(path.isAbsolute(configsecret.outfile)){
          outpath = configsecret.outfile;
        } else {
          outpath = path.join(config.relpath, configsecret.outfile);
        }
        // console.log('Got secret: %s', secret.Id);
        fs.writeFile(outpath, JSON.stringify(secret), (err) => {
          if(err) {
            console.error(chalk.red('Problem writing secret: %s', err));
          }
        });
      })
      .catch( err => {
        console.error(chalk.red(`Problem getting secret (id: ${configsecret.id}): ${err}`));
      });
  });
} else {
  Promise.map(secretIds, (secretId) => {
    return client.GetSecret(secretId)
      .then( secret => {
        secret = convertItemsDictionaryToArray(secret);
        if(program.simple) {
          secret = simplifyResult(secret);
        }
        secret.RetrievalStatus = 'Ok';
        return secret;
      })
      .catch( err => {
        console.error(chalk.red('Error retrieving secret ' + secretId + ': ' + err));
        return { Id: secretId, Error: err, RetrievalStatus: 'Error' };
      });
  }).then((results) => {
    results.forEach( result => {
      returnObject.Secrets.push(result);
    });
    if(program.filter) {
      emitOutput(jmespath.search(returnObject, program.filter));
    } else {
      emitOutput(returnObject);
    }
  }).catch( (err) => {
    console.error(chalk.red('Unhandled error retrieving secrets: ' + err));
  });
}

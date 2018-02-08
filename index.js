#!/usr/bin/env node

var program = require('commander');
var co = require('co');
var prompt = require('co-prompt');
var chalk = require('chalk');
var secretserver = require('@mr.xcray/thycotic-secretserver-client');
var _ = require('lodash');
var jmespath = require('jmespath');

let secret_id = null;
program
  .arguments('<secret-id>')
  .option('-u, --username [username]', 'Username with which to authenticate against secret server')
  .option('-p, --password <password>', 'Password with which to authenticate against secret server')
  .option('-w, --wsdl <wsdl-url>', 'URL to the secret server WSDL')
  .option('-a, --attachment-name <attachment-name>', 'Name of the attachment field to download.  This will only retrieve the attachment and not the entire secret')
  .option('-f, --filter <filter>', 'Filter the JSON output using a JMESPath filter')
  .option('--pretty', 'Pretty print JSON output')
  .option('--raw', 'output raw object, useful in conjunction with the --filter option')
  .option('-s,--simple', 'Output a simplified version of the secret')
  .action(function(arg) {
    secret_id = parseInt(arg);
  });

program.parse(process.argv);

let username = program.username || process.env.SECRETR_USERNAME;
let password = program.password || process.env.SECRETR_PASSWORD;
let wsdl = program.wsdl || process.env.SECRETR_WSDL;

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

const client = new secretserver(wsdl, username, password, organization='', domain='vistaprintus');
client.GetSecret(secret_id)
  .then( result => {
    result = convertItemsDictionaryToArray(result);
    if(program.simple){
      result = simplifyResult(result);
    }
    if(program.filter) {
      emitOutput(jmespath.search(result, program.filter));
    } else {
      emitOutput(result);
    }
  })
  .catch( err => {
    console.log(chalk.red(err));
  });

/*
  Usage examples:
  secretr --wsdl ....?wsdl -u user -p password <secret_id> --attachment-name Attachment --outfile myattachment.whatever
  secretr --config secretr.conf -u user -p password <secret_id> --outfile secret.json  # Secretrfile ??
  secretr .... <secret_id> #this will just output JSON to stdout
  env variables:
    SECRETR_WSDL
    SECRETR_USERNAME
    SECRETR_PASSWORD
*/
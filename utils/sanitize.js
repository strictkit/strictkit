function stripComments(code) {
  code = code.replace(/\/\*[\s\S]*?\*\//g, '');
  code = code.replace(/(?<!:)\/\/.*$/gm, '');
  return code;
}

function stripStrings(code) {
  code = code.replace(/`[^`]*`/g, '""');
  code = code.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  code = code.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return code;
}

module.exports = { stripComments, stripStrings };

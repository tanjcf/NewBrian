export function embedJsValue(value) {
  return JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (char) => {
    switch (char) {
      case "<": return "\\u003C";
      case ">": return "\\u003E";
      case "/": return "\\u002F";
      case "\u2028": return "\\u2028";
      case "\u2029": return "\\u2029";
      default: return char;
    }
  });
}

import { describe, expect, it } from 'vitest';
import { IdScanner } from '../../src/transport/id-scanner.js';

function scan(text: string, pieceSize = 0): string | number | null {
  const scanner = new IdScanner();
  const bytes = Buffer.from(text, 'utf8');
  if (pieceSize === 0) scanner.feed(bytes);
  else
    for (let i = 0; i < bytes.length; i += pieceSize)
      scanner.feed(bytes.subarray(i, i + pieceSize));
  return scanner.result();
}

describe('Given a JSON-RPC message scanned for its own top-level id', () => {
  it.each([
    ['id first', '{"jsonrpc":"2.0","id":7,"method":"ping"}', 7],
    [
      'id last, as the SDK client writes it',
      '{"method":"tools/call","params":{"a":1},"jsonrpc":"2.0","id":99}',
      99,
    ],
    ['a string id', '{"id":"abc-1","method":"ping"}', 'abc-1'],
    ['a negative id', '{"id":-3}', -3],
    ['whitespace around the colon', '{ "id" \n : \t 12 , "method":"x"}', 12],
    ['an escaped string id', '{"id":"a\\"b\\u0041","method":"x"}', 'a"bA'],
    ['a non-ASCII string id', '{"id":"é-1"}', 'é-1'],
  ])('When the message has %s, then the id is found', (_label, text, expected) => {
    expect(scan(text)).toBe(expected);
    expect(scan(text, 1)).toBe(expected);
    expect(scan(text, 5)).toBe(expected);
  });

  it.each([
    ['a nested id in params', '{"params":{"id":99},"method":"x"}'],
    ['a nested id before the real one is not used when there is none', '{"params":{"id":99}}'],
    ['an id inside a string value', '{"params":"{\\"id\\":5}","method":"x"}'],
    ['the word id as a string value', '{"method":"id","x":1}'],
    ['an id key inside an array of objects', '{"params":[{"id":4}]}'],
    ['a top-level array (batch)', '[{"id":1,"method":"x"}]'],
    ['an id that is an object', '{"id":{"a":1},"method":"x"}'],
    ['an id that is an array', '{"id":[1],"method":"x"}'],
    ['an id that is null, true or false', '{"id":null}'],
    ['an id that is true', '{"id":true}'],
    ['a fractional or huge number', '{"id":1.5}'],
    ['a number with too many digits', '{"id":1234567890123456789}'],
    ['a string that is too long', `{"id":"${'x'.repeat(200)}"}`],
    ['an id key written with escapes', '{"\\u0069d":5}'],
    ['no id at all', '{"jsonrpc":"2.0","method":"notifications/x"}'],
    ['not JSON at all', 'xxxxxxxxxx'],
    ['an unterminated message', '{"id":'],
  ])('When the message has %s, then the id is null', (_label, text) => {
    expect(scan(text)).toBeNull();
    expect(scan(text, 3)).toBeNull();
  });

  it('When a nested id comes before the real top-level id, then the real one wins', () => {
    expect(scan('{"params":{"id":1,"x":{"id":2}},"id":3}')).toBe(3);
  });

  it('When the top-level id appears twice, then the first is used', () => {
    expect(scan('{"id":1,"id":2}')).toBe(1);
  });

  it('When a string contains braces, brackets, colons, commas and escaped quotes, then nesting is not confused', () => {
    expect(scan('{"params":"} ], \\" { [ :","id":8}')).toBe(8);
  });

  it('When feeding continues after the answer is known, then later bytes do not change it', () => {
    const scanner = new IdScanner();
    scanner.feed(Buffer.from('{"id":4,'));
    scanner.feed(Buffer.from('"params":{"id":9}}'));
    expect(scanner.result()).toBe(4);
  });

  it('When a number ends the message without a closing brace, then it is not an answer', () => {
    expect(scan('{"id":12')).toBeNull();
  });
});

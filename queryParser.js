// ==========================================
// SERIES NUMERICAL NORMALIZER
// ==========================================

export function getCardSeriesNum(seriesStr) {
  if (!seriesStr) return -1;
  const s = seriesStr.trim();

  // Explicit mappings
  if (s === 'Season Pass') return 5;
  if (s === 'Limited Time Event') return 4;
  if (s === 'Starter') return 0;
  if (s === 'Unknown') return -1;
  if (s.startsWith('Recruit')) return 0;

  const match = s.match(/Series\s+(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }

  const numMatch = s.match(/(\d+)/);
  if (numMatch) {
    return parseInt(numMatch[1], 10);
  }

  return -1;
}

// ==========================================
// DESCRIPTION HELPER
// ==========================================

function getCleanDesc(card) {
  if (card._cleanDesc !== undefined) return card._cleanDesc;
  const raw = card['description'] || '';
  
  const noTags = raw.replace(/<[^>]*>/g, ' ').toLowerCase();
  const noPunct = noTags.replace(/[^\w\s+-]/g, ' ');
  card._cleanDesc = noPunct.split(/\s+/).join(' ');
  
  return card._cleanDesc;
}

function getNumericFieldValue(card, fieldName) {
  const f = fieldName.toLowerCase();
  if (f === 'c' || f === 'cost') {
    const val = parseFloat(card['data-card-cost']);
    return isNaN(val) ? null : val;
  }
  if (f === 'p' || f === 'pow' || f === 'power') {
    const val = parseFloat(card['data-card-power']);
    return isNaN(val) ? null : val;
  }
  if (f === 's' || f === 'series') {
    const val = getCardSeriesNum(card['data-card-series']);
    return isNaN(val) ? null : val;
  }
  return null;
}

// ==========================================
// QUERY PARSER (Tokenizer + AST + Matcher)
// ==========================================

export function tokenize(input) {
  const tokens = [];
  const regex = /(-?\(|\)|-?"[^"]*"|-?[^\s()]+)/g;
  let match;
  while ((match = regex.exec(input)) !== null) {
    const raw = match[0];
    const upper = raw.toUpperCase();

    if (raw === '(') {
      tokens.push({ type: 'LPAREN' });
    } else if (raw === '-(') {
      tokens.push({ type: 'NOT' });
      tokens.push({ type: 'LPAREN' });
    } else if (raw === ')') {
      tokens.push({ type: 'RPAREN' });
    } else if (upper === 'OR') {
      tokens.push({ type: 'OR' });
    } else if (upper === 'AND') {
      tokens.push({ type: 'AND' });
    } else if (upper === 'NOT') {
      tokens.push({ type: 'NOT' });
    } else {
      tokens.push({ type: 'TERM', value: raw });
    }
  }
  return tokens;
}

export class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  peek() { return this.tokens[this.pos]; }
  consume() { return this.tokens[this.pos++]; }

  parse() {
    if (!this.tokens.length) return null;
    return this.parseOr();
  }

  parseOr() {
    const nodes = [this.parseAnd()];
    while (this.peek() && this.peek().type === 'OR') {
      this.consume();
      nodes.push(this.parseAnd());
    }
    return nodes.length === 1 ? nodes[0] : { type: 'OR', children: nodes };
  }

  parseAnd() {
    const nodes = [this.parseUnary()];
    while (this.peek() && this.peek().type !== 'OR' && this.peek().type !== 'RPAREN') {
      if (this.peek().type === 'AND') {
        this.consume();
      }
      if (!this.peek() || this.peek().type === 'OR' || this.peek().type === 'RPAREN') {
        break;
      }
      nodes.push(this.parseUnary());
    }
    return nodes.length === 1 ? nodes[0] : { type: 'AND', children: nodes };
  }

  parseUnary() {
    const token = this.peek();
    if (!token) return { type: 'NOOP' };

    if (token.type === 'NOT') {
      this.consume();
      return { type: 'NOT', child: this.parseUnary() };
    }

    if (token.type === 'TERM' && token.value.startsWith('-') && !token.value.startsWith('->')) {
      const raw = this.consume().value.slice(1);
      return { type: 'NOT', child: this.createPredicate(raw) };
    }

    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();
    if (!token) return { type: 'NOOP' };

    if (token.type === 'LPAREN') {
      this.consume();
      const node = this.parseOr();
      if (this.peek() && this.peek().type === 'RPAREN') {
        this.consume();
      }
      return node;
    }

    if (token.type === 'TERM') {
      return this.createPredicate(this.consume().value);
    }

    this.consume();
    return { type: 'NOOP' };
  }

  createPredicate(term) {
    const isTermQuoted = term.startsWith('"') && term.endsWith('"');
    const cleanTerm = term.replace(/^"|"$/g, '');

    const fieldMatch = cleanTerm.match(/^([a-zA-Z]+)(<=|>=|!=|=|<|>|:)(.*)$/);

    if (fieldMatch) {
      const field = fieldMatch[1].toLowerCase();
      const op = fieldMatch[2];
      const rawVal = fieldMatch[3];
      const isValQuoted = rawVal.startsWith('"') && rawVal.endsWith('"');
      const val = rawVal.replace(/^"|"$/g, '');

      // 1. Cross-Field Comparison (e.g. pow>cost, p=c)
      const NUMERIC_FIELDS = ['c', 'cost', 'p', 'pow', 'power', 's', 'series'];
      if (NUMERIC_FIELDS.includes(field) && !isValQuoted) {
        const fieldCompareMatch = val.match(/^([a-zA-Z]+)([+-]\d+)?$/);
        if (fieldCompareMatch) {
          const targetField = fieldCompareMatch[1].toLowerCase();
          const offset = parseInt(fieldCompareMatch[2] || '0', 10);

          if (NUMERIC_FIELDS.includes(targetField)) {
            return {
              type: 'PRED',
              match: (card) => {
                const leftVal = getNumericFieldValue(card, field);
                const rightBase = getNumericFieldValue(card, targetField);
                if (leftVal === null || rightBase === null) return false;
                return this.compareNum(leftVal, op, rightBase + offset);
              }
            };
          }
        }
      }

      // 2. Cost (c or cost)
      if (field === 'c' || field === 'cost') {
        return {
          type: 'PRED',
          match: (card) => this.compareNum(card['data-card-cost'], op, val)
        };
      }

      // 3. Power (p, pow, or power)
      if (field === 'p' || field === 'pow' || field === 'power') {
        return {
          type: 'PRED',
          match: (card) => this.compareNum(card['data-card-power'], op, val)
        };
      }

      // 4. Series (s or series)
      if (field === 's' || field === 'series') {
        return {
          type: 'PRED',
          match: (card) => {
            const cardSeriesNum = getCardSeriesNum(card['data-card-series']);
            let targetNum = parseFloat(val);
            if (isNaN(targetNum)) {
              targetNum = getCardSeriesNum(val);
            }
            return this.compareNum(cardSeriesNum, op, targetNum);
          }
        };
      }

      // 5. Release Date (date, release, rel, or year)
      if (field === 'date' || field === 'release' || field === 'rel' || field === 'year') {
        return {
          type: 'PRED',
          match: (card) => this.compareDate(card['data-card-release'], op, val)
        };
      }

      // 6. Card Type (is:skill, is:spell, is:character, type:character, t:skill)
      if (field === 'is' || field === 'type' || field === 't') {
        const target = val.toLowerCase().trim();
        return {
          type: 'PRED',
          match: (card) => {
            const cardType = (card['data-card-type'] || '').toUpperCase();
            let isMatch = false;

            if (target === 'character') {
              isMatch = cardType === 'CHARACTER';
            } else if (target === 'skill' || target === 'spell') {
              isMatch = cardType === 'SPELL' || cardType === 'SKILL';
            } else {
              isMatch = cardType.toLowerCase() === target;
            }

            return op === '!=' ? !isMatch : isMatch;
          }
        };
      }

      // 7. Text/Ability ONLY (text, o, or ability)
      if (field === 'text' || field === 'o' || field === 'ability') {
        const regex = isValQuoted ? /[^\w\s+-]/g : /[^\w\s]/g;
        const searchWord = val.toLowerCase().replace(regex, ' ').split(/\s+/).join(' ').trim();
        return {
          type: 'PRED',
          match: (card) => {
            if (!searchWord) return true;
            const desc = getCleanDesc(card);
            return desc.includes(searchWord);
          }
        };
      }

      // 8. Name ONLY (name or n)
      if (field === 'name' || field === 'n') {
        const regex = isValQuoted ? /[^\w\s+-]/g : /[^\w\s]/g;
        const searchWord = val.toLowerCase().replace(regex, ' ').split(/\s+/).join(' ').trim();
        return {
          type: 'PRED',
          match: (card) => {
            if (!searchWord) return true;
            const name = (card['data-card-name'] || '').toLowerCase();
            return name.includes(searchWord);
          }
        };
      }
    }

    // Default: Plain text searches both Name and Ability Text
    const regex = isTermQuoted ? /[^\w\s+-]/g : /[^\w\s]/g;
    const searchWord = cleanTerm.toLowerCase().replace(regex, ' ').split(/\s+/).join(' ').trim();

    return {
      type: 'PRED',
      match: (card) => {
        if (!searchWord) return true;
        const name = (card['data-card-name'] || '').toLowerCase();
        const desc = getCleanDesc(card);
        return name.includes(searchWord) || desc.includes(searchWord);
      }
    };
  }

  compareNum(cardVal, op, targetVal) {
    const cardNum = typeof cardVal === 'number' ? cardVal : parseFloat(cardVal);
    const targetNum = typeof targetVal === 'number' ? targetVal : parseFloat(targetVal);
    if (isNaN(cardNum) || isNaN(targetNum)) return false;

    switch (op) {
      case ':':
      case '=': return cardNum === targetNum;
      case '!=': return cardNum !== targetNum;
      case '<':  return cardNum < targetNum;
      case '<=': return cardNum <= targetNum;
      case '>':  return cardNum > targetNum;
      case '>=': return cardNum >= targetNum;
      default: return false;
    }
  }

  normalizeDateTarget(target) {
    const parts = target.trim().split(/[-/.]/);
    if (parts.length === 1 && /^\d{4}$/.test(parts[0])) {
      return parts[0];
    }
    if (parts.length === 2 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}`;
    }
    if (parts.length === 3 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1]) && /^\d{1,2}$/.test(parts[2])) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    return target.trim();
  }

  compareDate(cardDateStr, op, targetVal) {
    if (!cardDateStr || !cardDateStr.trim()) {
      if (op === '<' || op === '<=' || op === '!=') return true;
      return false;
    }

    const cleanDate = cardDateStr.trim();
    const cleanTarget = this.normalizeDateTarget(targetVal);

    if (/^\d{4}$/.test(cleanTarget)) {
      const cardYear = cleanDate.slice(0, 4);
      switch (op) {
        case ':':
        case '=': return cardYear === cleanTarget;
        case '!=': return cardYear !== cleanTarget;
        case '<':  return cardYear < cleanTarget;
        case '<=': return cardYear <= cleanTarget;
        case '>':  return cardYear > cleanTarget;
        case '>=': return cardYear >= cleanTarget;
        default: return false;
      }
    }

    if (op === ':' || op === '=') {
      return cleanDate === cleanTarget || cleanDate.startsWith(cleanTarget);
    }
    if (op === '!=') {
      return cleanDate !== cleanTarget && !cleanDate.startsWith(cleanTarget);
    }

    switch (op) {
      case '<':  return cleanDate < cleanTarget;
      case '<=': return cleanDate <= cleanTarget || cleanDate.startsWith(cleanTarget);
      case '>':  return cleanDate > cleanTarget && !cleanDate.startsWith(cleanTarget);
      case '>=': return cleanDate >= cleanTarget;
      default: return false;
    }
  }
}

export function evaluateAST(node, card) {
  if (!node || node.type === 'NOOP') return true;
  if (node.type === 'AND') return node.children.every(ch => evaluateAST(ch, card));
  if (node.type === 'OR') return node.children.some(ch => evaluateAST(ch, card));
  if (node.type === 'NOT') return !evaluateAST(node.child, card);
  if (node.type === 'PRED') return node.match(card);
  return true;
}

export function parseQuery(rawQuery) {
  if (!rawQuery || !rawQuery.trim()) return null;
  try {
    const tokens = tokenize(rawQuery.trim());
    const parser = new Parser(tokens);
    return parser.parse();
  } catch (e) {
    console.error("Query parse error:", e);
    return null;
  }
}
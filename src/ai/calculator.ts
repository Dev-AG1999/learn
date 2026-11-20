/** Bounded rational arithmetic. Never eval user text or let a model execute code. */
type Fraction = { n: bigint; d: bigint }
function fraction(n: bigint, d = 1n): Fraction {
  if (!d) throw new Error("Division by zero is not allowed.")
  if (n.toString().length > 60 || d.toString().length > 60)
    throw new Error("Calculation is too large.")
  if (d < 0n) {
    n = -n
    d = -d
  }
  let a = n < 0n ? -n : n,
    b = d
  while (b) [a, b] = [b, a % b]
  return { n: n / a, d: d / a }
}
export function calculateQuestion(question: string): string | null {
  const expression = question
    .trim()
    .replace(/^(?:calculate|what is)\s+/i, "")
    .replace(/\?$/, "")
    .replace(/%\s*of\s*/gi, "%*")
  if (!/^[\d\s.+*/()%−-]+$/.test(expression) || expression.length > 160)
    return null
  const compact = expression.replace(/\s/g, "").replaceAll("−", "-")
  const tokens = compact.match(/\d+(?:\.\d+)?|[()+*/%\-]/g) ?? []
  if (tokens.join("") !== compact || tokens.length > 80)
    throw new Error("Use a simple arithmetic expression.")
  let position = 0
  function atom(): Fraction {
    const token = tokens[position++]
    let value: Fraction
    if (token === "-") {
      const v = atom()
      return { ...v, n: -v.n }
    }
    if (token === "+") return atom()
    if (token === "(") {
      value = sum()
      if (tokens[position++] !== ")")
        throw new Error("Close the calculation parentheses.")
    } else {
      if (!token || !/^\d+(?:\.\d+)?$/.test(token) || token.length > 18)
        throw new Error("Use numbers up to 18 digits.")
      const [whole, decimal = ""] = token.split(".")
      value = fraction(BigInt(whole + decimal), 10n ** BigInt(decimal.length))
    }
    if (tokens[position] === "%") {
      position++
      value = fraction(value.n, value.d * 100n)
    }
    return value
  }
  function product(): Fraction {
    let left = atom()
    while (tokens[position] === "*" || tokens[position] === "/") {
      const operator = tokens[position++],
        right = atom()
      left =
        operator === "*"
          ? fraction(left.n * right.n, left.d * right.d)
          : fraction(left.n * right.d, left.d * right.n)
    }
    return left
  }
  function sum(): Fraction {
    let left = product()
    while (tokens[position] === "+" || tokens[position] === "-") {
      const operator = tokens[position++],
        right = product()
      left = fraction(
        left.n * right.d + (operator === "+" ? 1n : -1n) * right.n * left.d,
        left.d * right.d
      )
    }
    return left
  }
  const result = sum()
  if (position !== tokens.length)
    throw new Error("Use a valid arithmetic expression.")
  const sign = result.n < 0n ? "-" : "",
    absolute = result.n < 0n ? -result.n : result.n
  const scaled = (absolute * 1000000n + result.d / 2n) / result.d
  const decimal = (scaled % 1000000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
  const answer = `${sign}${scaled / 1000000n}${decimal ? "." + decimal : ""}`
  return `${expression} = ${answer}${(absolute * 1000000n) % result.d ? " (rounded to six decimal places)" : ""}`
}

# Merge helper (docs/parallel-builds/README.md). Resolve git conflict blocks by keeping both sides (ours first); string-union types (`type X = 'a' | 'b';`) are merged.
import re, sys
def merge(a, b):
    ma = re.fullmatch(r"(\s*(?:export )?type \w+ = )(.*?);\n", a, re.S)
    mb = re.fullmatch(r"(\s*(?:export )?type \w+ = )(.*?);\n", b, re.S)
    if ma and mb and ma.group(1) == mb.group(1):
        items = [x.strip() for x in ma.group(2).split('|')]
        for x in (y.strip() for y in mb.group(2).split('|')):
            if x not in items: items.append(x)
        return ma.group(1) + ' | '.join(items) + ';\n'
    return a + b
for p in sys.argv[1:]:
    s = open(p).read()
    s = re.sub(r"^<<<<<<< [^\n]*\n(.*?)^=======\n(.*?)^>>>>>>> [^\n]*\n", lambda m: merge(m.group(1), m.group(2)), s, flags=re.S | re.M)
    open(p, 'w').write(s)

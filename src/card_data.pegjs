{
    function makeInteger(o) {
        return parseInt(o.join(""), 10);
    }
}

card_data "card data" = _ name:string _ types:list_of_types _ ":" _ base_score:integer slots:slot* _ {
    return {name, types, base_score, slots};
}
slot "slot" = _ "+" _ multiplier:integer _ "*" _ accepted:list_of_types _ { return {multiplier, accepted} }
list_of_types "list of types" = _ "{" _ list:string|1.., _ "," _| _ "}" _ { return list }

integer    = digits:[0-9]+ { return makeInteger(digits); }
string     = chars: (!delimiter @.)+ { return chars.join("") }
space      = " " / [\n\r\t]
paren      = "{" / "}"
delimiter  = paren / space / ","
_ = space*

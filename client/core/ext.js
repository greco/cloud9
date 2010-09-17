/**
 * Extension manager for the Ajax.org Cloud IDE
 *
 * Modules that extend the functionality of the editing environment
 * - Add menubuttons/menus
 * - Add items to menus (optional show/hide toggle)
 * - Add toolbar (optional show/hide toggle)
 * - Add buttons to toolbar (optional show/hide toggle)
 * - Add custom non-file tree items
 * - Register an editor to the application for file extensions
 * - Add features to existing editors
 * - Add AML elements
 * - Add layout modes
 */
require.def("core/ext", ["core/ide", "core/util"], function(ide, util) {

var ext;
ide.addEventListener("load", function(){
    ide.tabEditors.addEventListener("beforeswitch", function(e){
        ext.beforeswitch(e);
    });
    ide.tabEditors.addEventListener("afterswitch", function(e){
        ext.afterswitch(e);
    });
    ide.tabEditors.addEventListener("close", function(e){
        ext.close(e.page);
    });
});

return ext = {
    //Extension types
    GENERAL       : 1,
    LAYOUT        : 2,
    EDITOR        : 3,
    EDITOR_PLUGIN : 4,

    extensions    : [],
    extLut        : {},
    contenttypes  : {},
    typeLut       : {
        1 : "General",
        2 : "Layout",
        3 : "Editor",
        4 : "Editor Plugin"
    },

    currentLayoutMode : null,
    currentEditor     : null,

    register : function(path, oExtension, force){
        if (oExtension.registered)
            return oExtension;
        
        if (!mdlExt.queryNode("plugin[@path='" + path + "']"))
            mdlExt.appendXml('<plugin type="' + this.typeLut[oExtension.type]
                + '" name="' + (oExtension.name || "") + '" path="' + path
                + '" dev="' + (oExtension.dev || "") + '" enabled="1" />');
        else
            mdlExt.setQueryValue("plugin[@path='" + path + "']/@enabled", 1);
        
        //Don't init general extensions that cannot live alone
        if (!force && oExtension.type == this.GENERAL && !oExtension.alone) {
            oExtension.path = path;
            return oExtension;
        }

        oExtension.registered = true;
        oExtension.path     = path;

        switch(oExtension.type) {
            case this.GENERAL:
                this.initExtension(oExtension);

                //@todo
                //if (!this.currentEditor)
                    //oExtension.disable();
            break;
            case this.LAYOUT:
                oExtension.$layoutItem = ddModes.appendChild(new apf.item({
                    value   : path,
                    caption : oExtension.name
                }));
            break;
            case this.EDITOR:
                oExtension.contenttypes.each(function(mime){
                    ext.contenttypes[mime] = oExtension;
                });

                if (!this.contenttypes["default"])
                    this.contenttypes["default"] = oExtension;
            break;
            case this.EDITOR_PLUGIN:

            break;
        }

        this.extLut[path] = oExtension;
        this.extensions.push(oExtension);
        return oExtension;
    },

    unregister : function(oExtension, silent){
        //Check exts that depend on oExtension
        var using = oExtension.using;
        if (using) {
            var inUseBy = [];
            for (var use, i = 0, l = using.length; i < l; i++) {
                if ((use = using[i]).registered)
                    inUseBy.push(use.path);
            }
            
            if (inUseBy.length) {
                if (!silent)
                    util.alert(
                        "Could not disable extension",
                        "Extension is still in use",
                        "This extension cannot be disabled, because it is still in use by the following extensions:<br /><br />"
                        + " - " + inUseBy.join("<br /> - ")
                        + "<br /><br /> Please disable those extensions first.");
                return;
            }
        }

        delete oExtension.registered;
        this.extensions.remove(oExtension);
        delete this.extLut[oExtension.path];
        
        //Check deps to clean up
        var deps = oExtension.deps;
        if (deps) {
            for (var dep, i = 0, l = deps.length; i < l; i++) {
                dep = deps[i];
                if (dep.registered && dep.type == this.GENERAL && !oExtension.alone)
                    this.unregister(dep, true);
            }
        }
        
        switch(oExtension.type) {
            case this.GENERAL:

            break;
            case this.LAYOUT:
                oExtension.$layoutItem.destroy(true, true);
            break;
            case this.EDITOR:
                var _self = this;
                oExtension.contenttypes.each(function(fe){
                    delete _self.contenttypes[fe];
                });

                if (this.contenttypes["default"] == oExtension) {
                    delete this.contenttypes["default"];

                    for (prop in this.contenttypes) {
                        this.contenttypes["default"] = this.contenttypes[prop];
                        break;
                    }
                }
            break;
            case this.EDITOR_PLUGIN:

            break;
        }

        mdlExt.setQueryValue("plugin[@path='" + oExtension.path + "']/@enabled", 0);

        if (oExtension.inited) {
            oExtension.destroy();
            delete oExtension.inited;
        }
    },

    initExtension : function(oExtension, amlParent){
        //Load markup
        var markup = oExtension.markup;
        if (markup)
            apf.document.body.insertMarkup(markup);

        var deps = oExtension.deps;
        if (deps) {
            deps.each(function(dep){
                if (!dep.registered)
                    ext.register(dep.path, dep, true);

                (dep.using || (dep.using = [])).pushUnique(oExtension);
            });
        }

        oExtension.init(amlParent);
        oExtension.inited = true;
    },

    setLayoutMode : function(mode){
        if (this.currentLayoutMode)
            this.currentLayoutMode.disable();

        var module = this.extLut[mode];
        if (!module) {
            this.currentLayoutMode = null;
            return false;
        }

        if (!module.inited)
            this.initExtension(module);

        module.enable();
        this.currentLayoutMode = module;
    },

    openEditor : function(filename, xmlNode) {
        var page = ide.tabEditors.getPage(filename);
        if (page) {
            ide.tabEditors.set(page);
            return;
        }

        var contenttype = (xmlNode.getAttribute("contenttype") || "").split(";")[0];
        var editor = this.contenttypes[contenttype] || this.contenttypes["default"];

        if (this.currentEditor)
            this.currentEditor.disable();

        if (!editor) {
            util.alert(
                "No editor is registered",
                "Could you not find any editor to display content",
                "There is something wrong with the configuration of your IDE. No editor plugin is found.");
            return;
        }

        if (!editor.inited) {
            //Create Page Element
            var editorPage = new apf.page({
                id       : editor.path,
                visible  : false,
                realtime : false
            });
            ide.tabEditors.appendChild(editorPage);

            //Initialize Content of the page
            this.initExtension(editor, editorPage);
        }
        else
            editorPage = ide.tabEditors.getPage(editor.path);

        //Create Fake Page
        var fake  = tabEditors.add(filename, filename, editor.path);

        //Create ActionTracker
        var at    = fake.$at    = new apf.actiontracker();

        //Create Model
        var model = fake.$model = new apf.model();
        model.load(xmlNode);

        //Set active page
        tabEditors.set(filename);

        //Open tab, set as active and wait until opened
        /*fake.addEventListener("afteropen", function(){

        });*/

        editor.enable();

        this.currentEditor = editor;
    },

    close : function(page){
        page.addEventListener("afterclose", function(){
            app.session.$close(page);
        });
    },

    $close : function(page) {
        var handler    = this.extensions[page.type],
            editorPage = tabEditors.getPage(page.type);

        var at  = page.$at;
        var mdl = page.$model;

        //mdl.unshare();
        mdl.destroy();

        at.reset();
        at.destroy();

        //Destroy the app page if it has no application instance
        //if (!tabEditors.selectNodes("page[@type='" + page.type + "']").length && editorPage)
            //editorPage.destroy(true, true);
    },

    beforeswitch: function(e) {
        var page       = e.nextPage,
            editorPage = tabEditors.getPage(page.type);
        if (!editorPage) return;

        if (editorPage.model != page.$model)
            editorPage.setAttribute("model", page.$model);
        if (editorPage.actiontracker != page.$at)
            editorPage.setAttribute("actiontracker", page.$at);
    },

    afterswitch : function(e) {
        var page = e.nextPage;
        var fromHandler, toHandler = this.extLut[page.type];

        if (e.previousPage && e.previousPage != e.nextPage)
            fromHandler = this.extLut[e.previousPage.type];

        if (fromHandler != toHandler) {
            if (fromHandler)
                fromHandler.disable();
            toHandler.enable();
        }

        /*if (self.TESTING) {}
            //do nothing
        else if (page.appid)
            app.navigateTo(page.appid + "/" + page.id);
        else if (!page.id)
            app.navigateTo(app.loc || (app.loc = "myhome"));*/
    }
};

});